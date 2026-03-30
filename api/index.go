// 記帳本 v3 — Go 主程式（Vercel Serverless + Redis/KV）
package handler

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// ── 嵌入 public/icon 資料夾（因為 index.go 在 api/ 資料夾）──────────────────
//
/* go:embed ../public/icon */
var iconFS embed.FS

// ── Redis client（全域，冷啟動時初始化）────────────────────────────────────
var (
	rdb       *redis.Client
	ctx       = context.Background()
	redisOnce bool
)

const (
	recordsKey  = "kakeibo_records"
	settingsKey = "kakeibo_settings"
)

func getRedis() *redis.Client {
	if redisOnce {
		return rdb
	}
	redisOnce = true
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = os.Getenv("KV_URL")
	}
	if url == "" {
		return nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil
	}
	rdb = redis.NewClient(opt)
	return rdb
}

// ── 預設資料 ──────────────────────────────────────────────────────────────
var defaultSettings = map[string]interface{}{
	"categories": map[string]interface{}{
		"expense": []interface{}{
			map[string]interface{}{"id": "food", "name": "餐食、飲料", "color": "#FF5F6D"},
			map[string]interface{}{"id": "transport", "name": "交通", "color": "#FF9A5C"},
			map[string]interface{}{"id": "shopping", "name": "購物", "color": "#FFD166"},
			map[string]interface{}{"id": "entertainment", "name": "娛樂", "color": "#4CC9F0"},
			map[string]interface{}{"id": "health", "name": "醫療", "color": "#06D6A0"},
			map[string]interface{}{"id": "education", "name": "教育", "color": "#4895EF"},
			map[string]interface{}{"id": "home", "name": "居家", "color": "#7B5EA7"},
			map[string]interface{}{"id": "other", "name": "其他", "color": "#8B909A"},
		},
		"income": []interface{}{
			map[string]interface{}{"id": "salary", "name": "薪水", "color": "#06D6A0", "icon": "/icon/收入/薪水.png"},
			map[string]interface{}{"id": "bonus", "name": "獎金", "color": "#4CC9F0", "icon": "/icon/收入/獎金.png"},
			map[string]interface{}{"id": "invest", "name": "投資理財", "color": "#4895EF", "icon": "/icon/收入/投資理財.png"},
		},
		"transfer": []interface{}{
			map[string]interface{}{"id": "deposit", "name": "存款", "color": "#2ECC8F", "icon": "/icon/轉帳/存款.png"},
			map[string]interface{}{"id": "withdraw", "name": "提款", "color": "#FF5F6D", "icon": "/icon/轉帳/提款.png"},
			map[string]interface{}{"id": "transfer", "name": "轉帳", "color": "#4CC9F0", "icon": "/icon/轉帳/轉帳.png"},
		},
	},
	"account_groups": []interface{}{
		map[string]interface{}{"id": "cash", "name": "現金"},
		map[string]interface{}{"id": "bank", "name": "銀行"},
		map[string]interface{}{"id": "epay", "name": "電子支付"},
	},
	"accounts":  []interface{}{},
	"merchants": []interface{}{},
	"experts":   []interface{}{},
	"note_tags": []interface{}{},
}

// ── Redis helpers ─────────────────────────────────────────────────────────
func loadJSON(key string, defaultVal interface{}) interface{} {
	r := getRedis()
	if r == nil {
		return defaultVal
	}
	val, err := r.Get(ctx, key).Result()
	if err != nil || val == "" {
		saveJSON(key, defaultVal)
		return defaultVal
	}
	var data interface{}
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return defaultVal
	}
	// 補預設 account_groups
	if key == settingsKey {
		if m, ok := data.(map[string]interface{}); ok {
			if ag, ok := m["account_groups"].([]interface{}); !ok || len(ag) == 0 {
				m["account_groups"] = defaultSettings["account_groups"]
				saveJSON(key, m)
			}
		}
	}
	return data
}

func saveJSON(key string, data interface{}) {
	r := getRedis()
	if r == nil {
		return
	}
	b, _ := json.Marshal(data)
	r.Set(ctx, key, string(b), 0)
}

func newID() string {
	return time.Now().Format("20060102150405.000000")
}

// ── 餘額計算 ──────────────────────────────────────────────────────────────
func applyBalance(settings map[string]interface{}, rec map[string]interface{}, factor float64) {
	accs, _ := settings["accounts"].([]interface{})
	findAcc := func(id string) map[string]interface{} {
		for _, a := range accs {
			if am, ok := a.(map[string]interface{}); ok && am["id"] == id {
				return am
			}
		}
		return nil
	}
	toFloat := func(v interface{}) float64 {
		switch n := v.(type) {
		case float64:
			return n
		case string:
			f, _ := strconv.ParseFloat(n, 64)
			return f
		}
		return 0
	}
	rtype, _ := rec["type"].(string)
	amt := toFloat(rec["amount"])
	switch rtype {
	case "expense":
		if a := findAcc(fmt.Sprint(rec["account"])); a != nil {
			a["balance"] = toFloat(a["balance"]) - factor*amt
		}
	case "income":
		if a := findAcc(fmt.Sprint(rec["account"])); a != nil {
			a["balance"] = toFloat(a["balance"]) + factor*amt
		}
	case "piggy":
		if a := findAcc(fmt.Sprint(rec["account"])); a != nil {
			a["balance"] = toFloat(a["balance"]) + factor*amt
		}
	case "transfer":
		items, _ := rec["items"].([]interface{})
		if len(items) > 0 {
			it, _ := items[0].(map[string]interface{})
			itAmt := toFloat(it["amount"])
			if fa := findAcc(fmt.Sprint(it["from"])); fa != nil {
				fa["balance"] = toFloat(fa["balance"]) - factor*itAmt
			}
			if ta := findAcc(fmt.Sprint(it["to"])); ta != nil {
				ta["balance"] = toFloat(ta["balance"]) + factor*itAmt
			}
		}
	}
}

// ── JSON 回應 helper ─────────────────────────────────────────────────────
func jsonResp(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

// ── 主路由處理器 ─────────────────────────────────────────────────────────
// Handler is the Vercel entry point
func Handler(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path

	// ── API 路由 ──
	switch {
	// Records
	case p == "/api/records" && r.Method == http.MethodGet:
		handleGetRecords(w, r)
	case p == "/api/records" && r.Method == http.MethodPost:
		handleAddRecord(w, r)
	case strings.HasPrefix(p, "/api/records/") && r.Method == http.MethodDelete:
		handleDelRecord(w, r, strings.TrimPrefix(p, "/api/records/"))
	case strings.HasPrefix(p, "/api/records/") && r.Method == http.MethodPut:
		handleUpdateRecord(w, r, strings.TrimPrefix(p, "/api/records/"))

	// Report
	case p == "/api/report" && r.Method == http.MethodGet:
		handleReport(w, r)

	// Settings
	case p == "/api/settings" && r.Method == http.MethodGet:
		jsonResp(w, 200, loadJSON(settingsKey, defaultSettings))

	// Categories
	case strings.HasPrefix(p, "/api/settings/categories/"):
		rest := strings.TrimPrefix(p, "/api/settings/categories/")
		parts := strings.SplitN(rest, "/", 2)
		ct := parts[0]
		cid := ""
		if len(parts) > 1 {
			cid = parts[1]
		}
		switch {
		case cid == "" && r.Method == http.MethodPost:
			handleAddCat(w, r, ct)
		case cid != "" && r.Method == http.MethodDelete:
			handleDelCat(w, r, ct, cid)
		case cid != "" && r.Method == http.MethodPut:
			handleUpdateCat(w, r, ct, cid)
		default:
			http.NotFound(w, r)
		}

	// Accounts
	case p == "/api/settings/accounts" && r.Method == http.MethodPost:
		handleAddAcc(w, r)
	case strings.HasPrefix(p, "/api/settings/accounts/") && r.Method == http.MethodDelete:
		handleDelAcc(w, r, strings.TrimPrefix(p, "/api/settings/accounts/"))
	case strings.HasPrefix(p, "/api/settings/accounts/") && r.Method == http.MethodPut:
		handleUpdateAcc(w, r, strings.TrimPrefix(p, "/api/settings/accounts/"))

	// Account Groups
	case p == "/api/settings/account_groups" && r.Method == http.MethodPost:
		handleAddAG(w, r)
	case strings.HasPrefix(p, "/api/settings/account_groups/") && r.Method == http.MethodDelete:
		handleDelAG(w, r, strings.TrimPrefix(p, "/api/settings/account_groups/"))

	// Merchants
	case p == "/api/settings/merchants" && r.Method == http.MethodPost:
		handleAddMer(w, r)
	case strings.HasPrefix(p, "/api/settings/merchants/") && r.Method == http.MethodDelete:
		handleDelMer(w, r, strings.TrimPrefix(p, "/api/settings/merchants/"))

	// Experts
	case p == "/api/settings/experts" && r.Method == http.MethodPost:
		handleAddExp(w, r)
	case strings.HasPrefix(p, "/api/settings/experts/") && r.Method == http.MethodDelete:
		handleDelExp(w, r, strings.TrimPrefix(p, "/api/settings/experts/"))

	// Note Tags
	case p == "/api/settings/note_tags" && r.Method == http.MethodPost:
		handleAddNoteTag(w, r)
	case p == "/api/settings/note_tags" && r.Method == http.MethodPut:
		handleUpdateNoteTags(w, r)
	case strings.HasPrefix(p, "/api/settings/note_tags/") && r.Method == http.MethodDelete:
		handleDelNoteTag(w, r, strings.TrimPrefix(p, "/api/settings/note_tags/"))

	// Icons
	case p == "/api/icons" && r.Method == http.MethodGet:
		handleIcons(w, r)
	case p == "/api/icon-categories" && r.Method == http.MethodGet:
		handleIconCategories(w, r)

	// Backup / Restore / Reset
	case p == "/api/backup" && r.Method == http.MethodGet:
		handleBackup(w, r)
	case p == "/api/restore" && r.Method == http.MethodPost:
		handleRestore(w, r)
	case p == "/api/reset" && r.Method == http.MethodPost:
		saveJSON(recordsKey, []interface{}{})
		saveJSON(settingsKey, defaultSettings)
		jsonResp(w, 200, map[string]bool{"ok": true})
	case p == "/api/reset-records" && r.Method == http.MethodPost:
		handleResetRecords(w, r)

	default:
		http.NotFound(w, r)
	}
}

// ── Records ───────────────────────────────────────────────────────────────
func handleGetRecords(w http.ResponseWriter, r *http.Request) {
	recs, _ := loadJSON(recordsKey, []interface{}{}).([]interface{})
	y := r.URL.Query().Get("year")
	m := r.URL.Query().Get("month")
	if y != "" && m != "" {
		prefix := fmt.Sprintf("%s-%s", y, fmt.Sprintf("%02s", m))
		filtered := make([]interface{}, 0)
		for _, rec := range recs {
			if rm, ok := rec.(map[string]interface{}); ok {
				if d, _ := rm["date"].(string); strings.HasPrefix(d, prefix) {
					filtered = append(filtered, rec)
				}
			}
		}
		recs = filtered
	}
	sort.Slice(recs, func(i, j int) bool {
		ri, _ := recs[i].(map[string]interface{})
		rj, _ := recs[j].(map[string]interface{})
		di, _ := ri["date"].(string)
		ti, _ := ri["time"].(string)
		dj, _ := rj["date"].(string)
		tj, _ := rj["time"].(string)
		return di+ti > dj+tj
	})
	jsonResp(w, 200, recs)
}

func buildRecord(d map[string]interface{}) map[string]interface{} {
	items, _ := d["items"].([]interface{})
	var total float64
	rtype, _ := d["type"].(string)
	toFloat := func(v interface{}) float64 {
		switch n := v.(type) {
		case float64:
			return n
		case string:
			f, _ := strconv.ParseFloat(n, 64)
			return f
		}
		return 0
	}
	if rtype == "transfer" {
		for _, it := range items {
			if im, ok := it.(map[string]interface{}); ok {
				total += toFloat(im["amount"])
			}
		}
	} else {
		for _, it := range items {
			if im, ok := it.(map[string]interface{}); ok {
				total += toFloat(im["qty"]) * toFloat(im["price"])
				if toFloat(im["qty"]) == 0 {
					total += toFloat(im["price"]) // qty=0 treat as 1
				}
			}
		}
	}
	topcat := ""
	if len(items) > 0 {
		if im, ok := items[0].(map[string]interface{}); ok {
			topcat, _ = im["category"].(string)
		}
	}
	if topcat == "" {
		topcat, _ = d["category"].(string)
	}
	if topcat == "" {
		topcat = "other"
	}
	now := time.Now()
	dateStr := now.Format("2006-01-02")
	timeStr := now.Format("15:04")
	if ds, ok := d["date"].(string); ok && ds != "" {
		dateStr = ds
	}
	if ts, ok := d["time"].(string); ok && ts != "" {
		timeStr = ts
	}
	rec := map[string]interface{}{
		"id":         newID(),
		"type":       rtype,
		"amount":     total,
		"items":      items,
		"category":   topcat,
		"account":    strOrDefault(d, "account", "cash"),
		"to_account": strOrDefault(d, "to_account", ""),
		"merchant":   strOrDefault(d, "merchant", ""),
		"expert":     strOrDefault(d, "expert", ""),
		"date":       dateStr,
		"time":       timeStr,
		"note":       strOrDefault(d, "note", ""),
	}
	// extra piggy fields
	if pn, ok := d["piggyName"].(string); ok {
		rec["piggyName"] = pn
	}
	if pi, ok := d["piggyId"]; ok {
		rec["piggyId"] = pi
	}
	return rec
}

func strOrDefault(m map[string]interface{}, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func handleAddRecord(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var d map[string]interface{}
	json.Unmarshal(body, &d)
	recs, _ := loadJSON(recordsKey, []interface{}{}).([]interface{})
	rec := buildRecord(d)
	recs = append(recs, rec)
	saveJSON(recordsKey, recs)
	settings, _ := loadJSON(settingsKey, defaultSettings).(map[string]interface{})
	if settings == nil {
		settings = defaultSettings
	}
	applyBalance(settings, rec, 1)
	saveJSON(settingsKey, settings)
	jsonResp(w, 200, map[string]interface{}{"ok": true, "record": rec})
}

func handleDelRecord(w http.ResponseWriter, r *http.Request, rid string) {
	recs, _ := loadJSON(recordsKey, []interface{}{}).([]interface{})
	settings, _ := loadJSON(settingsKey, defaultSettings).(map[string]interface{})
	if settings == nil {
		settings = defaultSettings
	}
	newRecs := make([]interface{}, 0, len(recs))
	for _, rec := range recs {
		if rm, ok := rec.(map[string]interface{}); ok && rm["id"] == rid {
			applyBalance(settings, rm, -1)
		} else {
			newRecs = append(newRecs, rec)
		}
	}
	saveJSON(recordsKey, newRecs)
	saveJSON(settingsKey, settings)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleUpdateRecord(w http.ResponseWriter, r *http.Request, rid string) {
	body, _ := io.ReadAll(r.Body)
	var d map[string]interface{}
	json.Unmarshal(body, &d)
	recs, _ := loadJSON(recordsKey, []interface{}{}).([]interface{})
	settings, _ := loadJSON(settingsKey, defaultSettings).(map[string]interface{})
	if settings == nil {
		settings = defaultSettings
	}
	for idx, rec := range recs {
		rm, ok := rec.(map[string]interface{})
		if !ok || rm["id"] != rid {
			continue
		}
		applyBalance(settings, rm, -1)
		newRec := buildRecord(d)
		newRec["id"] = rid
		recs[idx] = newRec
		applyBalance(settings, newRec, 1)
		saveJSON(recordsKey, recs)
		saveJSON(settingsKey, settings)
		jsonResp(w, 200, map[string]interface{}{"ok": true, "record": newRec})
		return
	}
	jsonResp(w, 404, map[string]interface{}{"ok": false, "error": "not found"})
}

// ── Report ────────────────────────────────────────────────────────────────
func handleReport(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	y := now.Year()
	m := int(now.Month())
	if yv := r.URL.Query().Get("year"); yv != "" {
		y, _ = strconv.Atoi(yv)
	}
	if mv := r.URL.Query().Get("month"); mv != "" {
		m, _ = strconv.Atoi(mv)
	}
	prefix := fmt.Sprintf("%04d-%02d", y, m)
	allRecs, _ := loadJSON(recordsKey, []interface{}{}).([]interface{})
	toFloat := func(v interface{}) float64 {
		switch n := v.(type) {
		case float64:
			return n
		case string:
			f, _ := strconv.ParseFloat(n, 64)
			return f
		}
		return 0
	}
	var recs []interface{}
	var totalExp, totalInc float64
	catBD, incBD, merBD := map[string]float64{}, map[string]float64{}, map[string]map[string]interface{}{}
	// days in month
	daysInMonth := time.Date(y, time.Month(m+1), 0, 0, 0, 0, 0, time.UTC).Day()
	dayExp := map[string]float64{}
	dayInc := map[string]float64{}
	for d := 1; d <= daysInMonth; d++ {
		k := fmt.Sprintf("%02d", d)
		dayExp[k] = 0
		dayInc[k] = 0
	}
	for _, rec := range allRecs {
		rm, ok := rec.(map[string]interface{})
		if !ok {
			continue
		}
		dt, _ := rm["date"].(string)
		if !strings.HasPrefix(dt, prefix) {
			continue
		}
		recs = append(recs, rec)
		amt := toFloat(rm["amount"])
		rtype, _ := rm["type"].(string)
		day := ""
		if len(dt) >= 10 {
			day = dt[8:10]
		}
		switch rtype {
		case "expense":
			totalExp += amt
			if day != "" {
				dayExp[day] += amt
			}
			items, _ := rm["items"].([]interface{})
			if len(items) > 0 {
				for _, it := range items {
					if im, ok := it.(map[string]interface{}); ok {
						cid := fmt.Sprint(im["category"])
						itAmt := toFloat(im["qty"]) * toFloat(im["price"])
						if toFloat(im["qty"]) == 0 {
							itAmt = toFloat(im["price"])
						}
						catBD[cid] += itAmt
					}
				}
			} else {
				catBD[fmt.Sprint(rm["category"])] += amt
			}
			if mer := fmt.Sprint(rm["merchant"]); mer != "" && mer != "<nil>" {
				if merBD[mer] == nil {
					merBD[mer] = map[string]interface{}{"total": 0.0, "count": 0.0}
				}
				merBD[mer]["total"] = merBD[mer]["total"].(float64) + amt
				merBD[mer]["count"] = merBD[mer]["count"].(float64) + 1
			}
		case "income":
			totalInc += amt
			if day != "" {
				dayInc[day] += amt
			}
			items, _ := rm["items"].([]interface{})
			if len(items) > 0 {
				for _, it := range items {
					if im, ok := it.(map[string]interface{}); ok {
						cid := fmt.Sprint(im["category"])
						itAmt := toFloat(im["qty"]) * toFloat(im["price"])
						if toFloat(im["qty"]) == 0 {
							itAmt = toFloat(im["price"])
						}
						incBD[cid] += itAmt
					}
				}
			} else {
				incBD[fmt.Sprint(rm["category"])] += amt
			}
		}
	}
	jsonResp(w, 200, map[string]interface{}{
		"year": y, "month": m,
		"total_expense": totalExp, "total_income": totalInc,
		"net":                totalInc - totalExp,
		"cat_breakdown":      catBD,
		"inc_breakdown":      incBD,
		"merchant_breakdown": merBD,
		"records":            recs,
		"daily_expense":      dayExp,
		"daily_income":       dayInc,
	})
}

// ── Settings helpers ─────────────────────────────────────────────────────
func getSettings() map[string]interface{} {
	s, ok := loadJSON(settingsKey, defaultSettings).(map[string]interface{})
	if !ok || s == nil {
		b, _ := json.Marshal(defaultSettings)
		json.Unmarshal(b, &s)
	}
	return s
}

func readBody(r *http.Request) map[string]interface{} {
	body, _ := io.ReadAll(r.Body)
	var d map[string]interface{}
	json.Unmarshal(body, &d)
	return d
}

// ── Categories ────────────────────────────────────────────────────────────
func handleAddCat(w http.ResponseWriter, r *http.Request, ct string) {
	s := getSettings()
	d := readBody(r)
	newCat := map[string]interface{}{
		"id": "cat_" + newID(), "name": d["name"], "color": d["color"], "children": []interface{}{},
	}
	if ico, ok := d["icon"].(string); ok && ico != "" {
		newCat["icon"] = ico
	}
	cats, _ := s["categories"].(map[string]interface{})
	if cats == nil {
		cats = map[string]interface{}{}
		s["categories"] = cats
	}
	list, _ := cats[ct].([]interface{})
	parentID, _ := d["parent"].(string)
	if parentID != "" {
		list = insertChild(list, parentID, newCat)
	} else {
		list = append(list, newCat)
	}
	cats[ct] = list
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func insertChild(list []interface{}, parentID string, newCat interface{}) []interface{} {
	for _, item := range list {
		if im, ok := item.(map[string]interface{}); ok {
			if im["id"] == parentID {
				children, _ := im["children"].([]interface{})
				im["children"] = append(children, newCat)
				return list
			}
			if children, ok := im["children"].([]interface{}); ok {
				im["children"] = insertChild(children, parentID, newCat)
			}
		}
	}
	return list
}

func removeCat(list []interface{}, cid string) []interface{} {
	result := make([]interface{}, 0)
	for _, item := range list {
		if im, ok := item.(map[string]interface{}); ok {
			if im["id"] == cid {
				continue
			}
			if children, ok := im["children"].([]interface{}); ok {
				im["children"] = removeCat(children, cid)
			}
			result = append(result, im)
		}
	}
	return result
}

func handleDelCat(w http.ResponseWriter, r *http.Request, ct, cid string) {
	s := getSettings()
	cats, _ := s["categories"].(map[string]interface{})
	if cats != nil {
		list, _ := cats[ct].([]interface{})
		cats[ct] = removeCat(list, cid)
	}
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func updateCatRecurse(list []interface{}, cid string, d map[string]interface{}) bool {
	for _, item := range list {
		if im, ok := item.(map[string]interface{}); ok {
			if im["id"] == cid {
				if v, ok := d["name"]; ok {
					im["name"] = v
				}
				if v, ok := d["color"]; ok {
					im["color"] = v
				}
				if v, ok := d["icon"]; ok {
					im["icon"] = v
				}
				return true
			}
			if children, ok := im["children"].([]interface{}); ok {
				if updateCatRecurse(children, cid, d) {
					return true
				}
			}
		}
	}
	return false
}

func handleUpdateCat(w http.ResponseWriter, r *http.Request, ct, cid string) {
	s := getSettings()
	d := readBody(r)
	cats, _ := s["categories"].(map[string]interface{})
	if cats != nil {
		list, _ := cats[ct].([]interface{})
		updateCatRecurse(list, cid, d)
	}
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Accounts ──────────────────────────────────────────────────────────────
func handleAddAcc(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	d := readBody(r)
	bal, _ := strconv.ParseFloat(fmt.Sprint(d["balance"]), 64)
	acc := map[string]interface{}{
		"id": "acc_" + newID(), "name": d["name"],
		"group": d["group"], "balance": bal,
	}
	for _, k := range []string{"balance_date", "color", "icon"} {
		if v, ok := d[k]; ok && v != nil {
			acc[k] = v
		}
	}
	accs, _ := s["accounts"].([]interface{})
	s["accounts"] = append(accs, acc)
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleDelAcc(w http.ResponseWriter, r *http.Request, aid string) {
	s := getSettings()
	accs, _ := s["accounts"].([]interface{})
	filtered := make([]interface{}, 0)
	for _, a := range accs {
		if am, ok := a.(map[string]interface{}); ok && am["id"] != aid {
			filtered = append(filtered, a)
		}
	}
	s["accounts"] = filtered
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleUpdateAcc(w http.ResponseWriter, r *http.Request, aid string) {
	s := getSettings()
	d := readBody(r)
	accs, _ := s["accounts"].([]interface{})
	for _, a := range accs {
		if am, ok := a.(map[string]interface{}); ok && am["id"] == aid {
			for _, k := range []string{"name", "group", "balance", "balance_date", "color", "icon"} {
				if v, ok := d[k]; ok {
					am[k] = v
				}
			}
			break
		}
	}
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Account Groups ────────────────────────────────────────────────────────
func handleAddAG(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	d := readBody(r)
	ags, _ := s["account_groups"].([]interface{})
	s["account_groups"] = append(ags, map[string]interface{}{"id": "grp_" + newID(), "name": d["name"]})
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleDelAG(w http.ResponseWriter, r *http.Request, gid string) {
	s := getSettings()
	ags, _ := s["account_groups"].([]interface{})
	filtered := make([]interface{}, 0)
	for _, g := range ags {
		if gm, ok := g.(map[string]interface{}); ok && gm["id"] != gid {
			filtered = append(filtered, g)
		}
	}
	s["account_groups"] = filtered
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Merchants ─────────────────────────────────────────────────────────────
func handleAddMer(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	d := readBody(r)
	mers, _ := s["merchants"].([]interface{})
	s["merchants"] = append(mers, map[string]interface{}{"id": "mer_" + newID(), "name": d["name"]})
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleDelMer(w http.ResponseWriter, r *http.Request, mid string) {
	s := getSettings()
	mers, _ := s["merchants"].([]interface{})
	filtered := make([]interface{}, 0)
	for _, m := range mers {
		if mm, ok := m.(map[string]interface{}); ok && mm["id"] != mid {
			filtered = append(filtered, m)
		}
	}
	s["merchants"] = filtered
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Experts ───────────────────────────────────────────────────────────────
func handleAddExp(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	d := readBody(r)
	exps, _ := s["experts"].([]interface{})
	s["experts"] = append(exps, map[string]interface{}{"id": "exp_" + newID(), "name": d["name"]})
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleDelExp(w http.ResponseWriter, r *http.Request, eid string) {
	s := getSettings()
	exps, _ := s["experts"].([]interface{})
	filtered := make([]interface{}, 0)
	for _, e := range exps {
		if em, ok := e.(map[string]interface{}); ok && em["id"] != eid {
			filtered = append(filtered, e)
		}
	}
	s["experts"] = filtered
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Note Tags ─────────────────────────────────────────────────────────────
func handleAddNoteTag(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	d := readBody(r)
	tags, _ := s["note_tags"].([]interface{})
	s["note_tags"] = append(tags, map[string]interface{}{
		"id": "tag_" + newID(), "name": d["name"], "category": d["category"],
	})
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleUpdateNoteTags(w http.ResponseWriter, r *http.Request) {
	s := getSettings()
	body, _ := io.ReadAll(r.Body)
	var d []interface{}
	if json.Unmarshal(body, &d) == nil {
		s["note_tags"] = d
		saveJSON(settingsKey, s)
	}
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleDelNoteTag(w http.ResponseWriter, r *http.Request, tid string) {
	s := getSettings()
	tags, _ := s["note_tags"].([]interface{})
	filtered := make([]interface{}, 0)
	for _, t := range tags {
		if tm, ok := t.(map[string]interface{}); ok && tm["id"] != tid {
			filtered = append(filtered, t)
		}
	}
	s["note_tags"] = filtered
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}

// ── Icons ─────────────────────────────────────────────────────────────────
func handleIcons(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	var files []string

	if category != "" {
		// 因為已 embed ../public/icon，所以這裡直接用分類名稱
		entries, err := iconFS.ReadDir(category)
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					files = append(files, category+"/"+e.Name())
				}
			}
		}
	} else {
		entries, err := iconFS.ReadDir(".")
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					files = append(files, e.Name())
				}
			}
		}
	}

	sort.Strings(files)
	jsonResp(w, 200, files)
}

// ── 內建圖示分類 ─────────────────────────────────────────────────────────
func handleIconCategories(w http.ResponseWriter, r *http.Request) {
	defaults := []string{"餐食、飲料", "生活支出", "交通", "收入", "帳戶", "轉帳"}
	seen := map[string]bool{}
	result := make([]string, 0)

	for _, d := range defaults {
		if !seen[d] {
			seen[d] = true
			result = append(result, d)
		}
	}

	// 掃描 ../public/icon 下的所有子資料夾
	entries, err := iconFS.ReadDir(".")
	if err == nil {
		for _, e := range entries {
			if e.IsDir() && !seen[e.Name()] {
				seen[e.Name()] = true
				result = append(result, e.Name())
			}
		}
	}

	jsonResp(w, 200, result)
}

// ── Backup / Restore / Reset ──────────────────────────────────────────────
func handleBackup(w http.ResponseWriter, r *http.Request) {
	data := map[string]interface{}{
		"exported_at": time.Now().Format(time.RFC3339),
		"records":     loadJSON(recordsKey, []interface{}{}),
		"settings":    loadJSON(settingsKey, defaultSettings),
	}
	b, _ := json.MarshalIndent(data, "", "  ")
	filename := fmt.Sprintf("kakeibo_%s.json", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Write(b)
}

func handleRestore(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var d map[string]interface{}
	json.Unmarshal(body, &d)
	if recs, ok := d["records"]; ok {
		saveJSON(recordsKey, recs)
	}
	if s, ok := d["settings"]; ok {
		saveJSON(settingsKey, s)
	}
	jsonResp(w, 200, map[string]bool{"ok": true})
}

func handleResetRecords(w http.ResponseWriter, r *http.Request) {
	saveJSON(recordsKey, []interface{}{})
	s := getSettings()
	if accs, ok := s["accounts"].([]interface{}); ok {
		for _, a := range accs {
			if am, ok := a.(map[string]interface{}); ok {
				am["balance"] = 0.0
			}
		}
	}
	saveJSON(settingsKey, s)
	jsonResp(w, 200, map[string]bool{"ok": true})
}
