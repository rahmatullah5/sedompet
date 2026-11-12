#!/usr/bin/env python3
"""Turn a Cashew backup (SQLite) into a Supabase seed SQL file for one phone number.

The SQL creates a Dompet owned by a *placeholder* member for that phone. When the
person signs up/logs in with that number, the app calls claim_phone_membership()
and they become the owner. Run the output once in Supabase > SQL Editor.

Mapping and IDs match web/src/db/importCashew.ts, so importing the same backup
again from the app adds no duplicates.

Usage:
  python3 -I supabase/tools/cashew_to_seed.py BACKUP.sql 0812xxxx \
      --dompet "Dompet Keluarga" --name "Saya" -o supabase/seed_private/seed.sql
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sqlite3
import sys

ICONS = {
    "cutlery": "🍽️", "bread": "🍞", "shopping": "🛍️", "gift": "🎁", "popcorn": "🍿", "bills": "🧾", "tram": "🚋",
    "flower": "🌸", "plane": "✈️", "rent": "🏠", "motor-bike": "🏍️", "bookshelf": "📚", "tablet": "📱", "weight": "🏋️",
    "charts": "📈", "coin": "🪙", "tie": "👔", "groceries": "🛒", "coffee": "☕", "car": "🚗", "bus": "🚌", "gas": "⛽",
    "fuel": "⛽", "health": "💊", "pill": "💊", "medicine": "💊", "baby": "👶", "school": "🎒", "education": "🎓", "book": "📚",
    "game": "🎮", "music": "🎵", "movie": "🎬", "phone": "📱", "wifi": "📶", "internet": "📶", "electricity": "💡", "water": "🚰",
    "house": "🏠", "home": "🏠", "pet": "🐾", "dog": "🐶", "cat": "🐱", "clothes": "👕", "shirt": "👕", "shoe": "👟", "beauty": "💄",
    "salary": "💼", "money": "💰", "wallet": "👛", "bank": "🏦", "credit-card": "💳", "card": "💳", "piggy": "🐷", "savings": "🐷",
    "insurance": "🛡️", "tax": "🧾", "charity": "🤲", "donation": "🤲", "travel": "🧳", "hotel": "🏨", "sport": "⚽", "gym": "🏋️",
    "drink": "🥤", "beer": "🍺", "pizza": "🍕", "burger": "🍔", "fast": "🍔", "taxi": "🚕", "train": "🚆", "bike": "🚲", "tools": "🔧",
    "repair": "🔧", "computer": "💻", "laptop": "💻", "electronic": "🔌", "subscription": "🔁", "streaming": "📺", "tv": "📺",
}


def normalize_phone(p: str) -> str:
    d = re.sub(r"\D", "", p)
    if d.startswith("0"):
        d = "62" + d[1:]
    elif d.startswith("8"):
        d = "62" + d
    if not re.fullmatch(r"62\d{8,13}", d):
        sys.exit(f"Invalid Indonesian phone number: {p}")
    return d


def stable_id(*parts: str) -> str:
    """Same as stableId() in importCashew.ts: SHA-1 of parts joined by '|', v5 layout."""
    b = bytearray(hashlib.sha1("|".join(parts).encode()).digest()[:16])
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def icon_for(emoji, icon_name, fallback):
    if emoji and emoji.strip():
        return emoji.strip()
    if icon_name:
        base = re.sub(r"\(\d+\)$", "", re.sub(r"\.png$", "", icon_name, flags=re.I)).lower()
        if base in ICONS:
            return ICONS[base]
        for k, v in ICONS.items():
            if k in base:
                return v
    return fallback


def colour_for(c, fallback):
    m = re.fullmatch(r"0x[0-9a-fA-F]{2}([0-9a-fA-F]{6})", c or "")
    return f"#{m.group(1).lower()}" if m else fallback


def account_type(name):
    n = name.lower()
    if re.search(r"(gopay|ovo|dana|shopee|linkaja|spay|e-?wallet|flip|jenius pay)", n):
        return "ewallet"
    if re.search(r"(cash|tunai|dompet|kas\b)", n):
        return "cash"
    if re.search(r"(tabung|saving|invest|deposit|emas|gold|reksa|saham|stock)", n):
        return "savings"
    return "bank"


def q(v):
    """SQL literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def local_date(sec):
    return dt.datetime.fromtimestamp(sec).date().isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("backup")
    ap.add_argument("phone")
    ap.add_argument("--dompet", default="Dompet Keluarga")
    ap.add_argument("--name", default="Saya", help="your display name in the Dompet")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()

    phone = normalize_phone(a.phone)
    dompet_id = stable_id("cashew-seed", phone, "dompet")
    member_id = stable_id("cashew-seed", phone, "member")
    d = dompet_id

    src = sqlite3.connect(f"file:{a.backup}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    cols = lambda t: {r["name"] for r in src.execute(f"PRAGMA table_info({t})")}

    wallets = src.execute('SELECT * FROM wallets ORDER BY "order"').fetchall()
    cats = src.execute('SELECT * FROM categories ORDER BY main_category_pk IS NOT NULL, "order"').fetchall()
    txs = src.execute("SELECT * FROM transactions").fetchall()
    objs = src.execute("SELECT * FROM objectives WHERE type = 1").fetchall() if "type" in cols("objectives") else []
    budgets = src.execute("SELECT * FROM budgets").fetchall()
    has_loan_fk = "objective_loan_fk" in cols("transactions")
    has_exclude = "category_fks_exclude" in cols("budgets")

    # Cashew lets a subcategory's income flag differ from its parent; Sedompet
    # requires subcategories to follow the parent's kind.
    income_of = {c["category_pk"]: c["income"] for c in cats}
    kind_of = lambda c: "income" if income_of.get(c["main_category_pk"], c["income"]) else "expense"
    acc = {w["wallet_pk"]: stable_id("cashew", d, "wallet", w["wallet_pk"]) for w in wallets}
    cat = {c["category_pk"]: stable_id("cashew", d, "category", c["category_pk"]) for c in cats}
    loan = {o["objective_pk"]: stable_id("cashew", d, "loan", o["objective_pk"]) for o in objs}

    out = []
    w = out.append
    w("-- Sedompet initial data generated from a Cashew backup. PRIVATE: contains personal finance data.")
    w(f"-- Generated {dt.datetime.now().isoformat(timespec='seconds')}. Safe to re-run (on conflict do nothing).")
    w("begin;")
    w(f"select public.admin_activate_phone({q(phone)});")
    w(f"insert into public.dompets (id, name, currency) values ({q(dompet_id)}, {q(a.dompet)}, 'IDR') on conflict (id) do nothing;")
    w(
        "insert into public.dompet_members (id, dompet_id, phone, role, display_name, colour, emoji, user_id) values "
        f"({q(member_id)}, {q(dompet_id)}, {q(phone)}, 'owner', {q(a.name)}, '#f47c5a', '🙂', "
        f"(select user_id from public.phone_access where phone = {q(phone)})) on conflict (id) do nothing;"
    )

    rows = []
    for x in wallets:
        rows.append(
            f"({q(acc[x['wallet_pk']])}, {q(d)}, {q((x['name'] or 'Akun')[:40])}, {q(account_type(x['name'] or ''))}, 0, "
            f"{q(colour_for(x['colour'], '#f47c5a'))}, {q(x['emoji_icon_name'] or None)}, 'shared', null, {q(bool(x['archived']))}, {q(member_id)})"
        )
    if rows:
        w("insert into public.accounts (id, dompet_id, name, type, opening_balance, colour, icon, visibility, owner_member_id, archived, created_by) values\n  "
          + ",\n  ".join(rows) + "\non conflict (id) do nothing;")

    for parents in (True, False):
        rows = []
        for c in cats:
            if c["category_pk"] == "0" or (c["main_category_pk"] is None) != parents:
                continue
            parent = cat.get(c["main_category_pk"]) if c["main_category_pk"] else None
            rows.append(
                f"({q(cat[c['category_pk']])}, {q(d)}, {q((c['name'] or 'Kategori')[:40])}, "
                f"{q(icon_for(c['emoji_icon_name'], c['icon_name'], '💰' if kind_of(c) == 'income' else '📦'))}, "
                f"{q(colour_for(c['colour'], '#b29d8b'))}, {q(kind_of(c))}, {q(parent)}, {100 + (c['order'] or 0)})"
            )
        if rows:
            w("insert into public.categories (id, dompet_id, name, icon, colour, kind, parent_id, sort_order) values\n  "
              + ",\n  ".join(rows) + "\non conflict (id) do nothing;")

    rows = []
    first_acc = next(iter(acc.values()), None)
    for o in objs:
        account = acc.get(o["wallet_fk"], first_acc)
        if not account:
            continue
        rows.append(
            f"({q(loan[o['objective_pk']])}, {q(d)}, {q('lent' if o['income'] else 'borrowed')}, {q((o['name'] or 'Pinjaman')[:60])}, "
            f"{max(1, round(abs(o['amount'])))}, {q(account)}, {q(local_date(o['date_created']))}, "
            f"{q(local_date(o['end_date']) if o['end_date'] else None)}, '', {q(bool(o['archived']))}, {q(member_id)})"
        )
    if rows:
        w("insert into public.loans (id, dompet_id, direction, counterparty, amount, account_id, start_date, due_date, note, settled, created_by) values\n  "
          + ",\n  ".join(rows) + "\non conflict (id) do nothing;")

    stats = {"tx": 0, "transfer": 0, "adjustment": 0, "skipped": 0}
    tx_rows = []
    for t in txs:
        amount = round(abs(t["amount"]))
        account = acc.get(t["wallet_fk"])
        if not t["paid"] or amount == 0 or not account:
            stats["skipped"] += 1
            continue
        loan_id = loan.get(t["objective_loan_fk"]) if has_loan_fk and t["objective_loan_fk"] else None
        flag = "transfer" if t["paired_transaction_fk"] else "adjustment" if t["category_fk"] == "0" else "loan" if loan_id else None
        category = None if flag in ("transfer", "adjustment") else (cat.get(t["sub_category_fk"]) if t["sub_category_fk"] else None) or cat.get(t["category_fk"])
        title = (t["name"] or "").strip()
        extra = (t["note"] or "").strip()
        note = " · ".join([s for s in (title, extra if extra != title else "") if s])[:140]
        created = dt.datetime.fromtimestamp(t["date_created"], dt.timezone.utc).isoformat()
        tx_rows.append(
            f"({q(stable_id('cashew', d, 'tx', t['transaction_pk']))}, {q(d)}, {q(account)}, {q(category)}, "
            f"{q('expense' if t['amount'] < 0 else 'income')}, {amount}, {q(local_date(t['date_created']))}, {q(note)}, {q(flag)}, {q(loan_id)}, "
            f"{q(member_id)}, {q(member_id)}, {q(member_id)}, {q(created)})"
        )
        stats["tx"] += 1
        if flag in ("transfer", "adjustment"):
            stats[flag] += 1
    for i in range(0, len(tx_rows), 500):
        w("insert into public.transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, loan_id, paid_by, created_by, updated_by, created_at) values\n  "
          + ",\n  ".join(tx_rows[i:i + 500]) + "\non conflict (id) do nothing;")

    rows = []
    for b in budgets:
        # Cashew reoccurrence: 1 daily, 2 weekly, 3 monthly (0 custom, 4 yearly are skipped)
        period = {1: "daily", 2: "weekly", 3: "monthly"}.get(b["reoccurrence"])
        if b["archived"] or not period or b["period_length"] != 1:
            continue
        cat_list = json.loads(b["category_fks"] or "[]")
        category = cat.get(cat_list[0]) if len(cat_list) == 1 else None
        excl = [cat[x] for x in json.loads((b["category_fks_exclude"] if has_exclude else None) or "[]") if x in cat]
        excl_sql = "array[" + ",".join(q(x) for x in excl) + "]::uuid[]" if excl and not category else "'{}'::uuid[]"
        rows.append(
            f"({q(stable_id('cashew', d, 'budget', b['budget_pk']))}, {q(d)}, {q((b['name'] or 'Anggaran')[:40])}, "
            f"{max(1, round(b['amount']))}, {q(category)}, null, {excl_sql}, {q(period)}, {q(member_id)})"
        )
    if rows:
        w("insert into public.budgets (id, dompet_id, name, amount, category_id, member_id, exclude_category_ids, period, created_by) values\n  "
          + ",\n  ".join(rows) + "\non conflict (id) do nothing;")

    # Mark loans repaid in full as settled.
    w(f"""update public.loans l set settled = true where l.dompet_id = {q(d)} and not l.settled and l.amount <= coalesce((
  select sum(t.amount) from public.transactions t where t.loan_id = l.id
    and t.kind = case l.direction when 'lent' then 'income' else 'expense' end), 0);""")
    w(f"insert into public.activity (id, dompet_id, member_id, message) values ({q(stable_id('cashew-seed', phone, 'activity'))}, {q(d)}, {q(member_id)}, "
      f"{q(f'mengimpor {stats[chr(116)+chr(120)]} transaksi dari file backup')}) on conflict (id) do nothing;")
    w("commit;")

    with open(a.out, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"Wrote {a.out}: dompet {dompet_id}, {len(wallets)} accounts, {len(cats) - 1} categories, "
          f"{stats['tx']} transactions ({stats['transfer']} transfers, {stats['adjustment']} corrections), "
          f"{len(objs)} loans, {len(rows)} budgets; skipped {stats['skipped']}.")


if __name__ == "__main__":
    main()
