import json, sys, os
from datetime import datetime, timezone
sys.path.insert(0, os.path.expanduser("~/mnt/CompanyMonitor"))
os.environ.pop("SERPAPI_GL", None); os.environ.pop("SERPAPI_HL", None)
import bulk_search as bs, monitor
NOW = datetime(2026, 9, 15, 10, 30, tzinfo=timezone.utc)
out = {}
dates = ["3 days ago", "1 hour ago", "2 weeks ago", "1 month ago", "45 minutes ago", "Yesterday", "yesterday",
         "Jul 8, 2026", "jul 8, 2026", "Sep 30, 2025", "8 Jul 2026", "07/08/2026", "7/8/2026",
         "2026-07-08T07:09:00Z", "2026-07-08T07:09:00.123Z", "2026-07-08T23:30:00+05:30", "2026-07-08 23:30:00 +05:30",
         "20260708T070900Z", "Wed, 08 Jul 2026 07:09:00 GMT", "Wed, 8 Jul 2026 23:09:00 -0500", "July 8, 2026", "Sept 8, 2026",
         "", "  ", "garbage", "2 days", "1 year ago", "Jul 32, 2026", "02/30/2026"]
out["parse_pub_date"] = [[d, (lambda r: r.isoformat() if r else None)(monitor.parse_pub_date(d, now=NOW))] for d in dates]
out["parse_queries"] = [[s, bs.parse_queries(s)] for s in [
    "alpha\nbeta, gamma\n\n alpha \n", '"Safari Industries"', '"a" OR "b"', '("a, b" OR c)', "  ", "q1\r\nq2", '""', '" x "']]
out["news_query"] = [[q, s, e, bs.news_query(q, s, e)] for q, s, e in [("acme", "2026-09-01", "2026-09-30"), ("acme", "", ""), ("acme", "2026-12-31", "2026-12-31")]]
out["pages_for"] = [[v, p, bs.pages_for(v, p)] for v, p in [("web", 3), ("news", 9), ("news_tab", 99), ("web", "x"), ("web", 0), ("web", "7"), ("web", None)]]
out["build_params"] = []
for args in [("acme", "2026-09-01", "2026-09-30", "web", "in"), ("acme", "", "", "web", "us"), ("acme", "2026-09-01", "2026-09-30", "news", "in"),
             ("acme", "2026-09-01", "2026-09-30", "news_tab", "us"), ("acme", "", "", "news_tab", "in")]:
    p = bs.build_params(args[0], args[1], args[2], args[3], "KEY", args[4])
    out["build_params"].append([list(args), p])
out["page_params"] = [bs._page_params({"q": "a"}, 0), bs._page_params({"q": "a"}, 3)]
item = lambda i, **kw: {"title": f"T{i}", "link": f"https://www.site{i}.com/a", "snippet": f"S{i}", "date": kw.get("date", ""), "source": kw.get("source", "Out"), **({"iso_date": kw["iso"]} if "iso" in kw else {})}
results = [item(1, date="3 days ago"), {"title": "nolink"}, item(2, date="Jul 8, 2026", source={"name": "News Co"}), item(3, iso="2026-09-01T23:30:00Z"), item(4, date="Aug 1, 2026")] + [item(i) for i in range(5, 14)]
import monitor as m
orig = m.parse_pub_date
m.parse_pub_date = lambda raw, now=None: orig(raw, now=NOW)
out["map_results"] = {"web": bs.map_results(results, "acme", "web", "2026-09-15T10:30:00+00:00", "2026-09-01", "2026-09-30"),
                      "news": bs.map_results(results, "acme", "news", "2026-09-15T10:30:00+00:00", "", ""),
                      "input": results}
clusters = [{"highlight": {"title": "H", "link": "https://h.com"}, "stories": [{"title": "S1", "link": "https://s1.com"}, "bad"]}, {"title": "P", "link": "https://p.com"}, "junk", {"stories": []}]
out["flatten_news"] = [clusters, bs.flatten_news(clusters)]
out["is_last_page"] = [[n, nxt, bs._is_last_page([{}] * n, {"serpapi_pagination": {"next": "u"} if nxt else {}})] for n in (0, 5, 9, 10) for nxt in (False, True)]
out["tbs"] = monitor._serp_tbs(None, "2026-09-01", "2026-09-30")
rows = out["map_results"]["web"][:3]
out["export"] = [bs.EXPORT_COLUMNS, bs.export_rows(rows), rows]
print(json.dumps(out, indent=1, default=str))
