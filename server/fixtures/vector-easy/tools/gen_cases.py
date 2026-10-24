"""造题 + 生成参考值（**不下发**）：按主诉找相似病例（词表向量 + 余弦 + Top-K）。"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
CASES = HERE / "problem" / "cases"

CONCEPTS = {
    "dim": 8,
    "concepts": ["胸痛", "气短", "心悸", "发热", "咳嗽", "头痛", "腹痛", "乏力"],
    "synonyms": {
        "心梗": "胸痛", "胸闷": "胸痛", "喘不上气": "气短", "心慌": "心悸",
        "发烧": "发热", "低热": "发热", "干咳": "咳嗽", "肚子痛": "腹痛", "没力气": "乏力",
    },
}

DOCS = {
    "case01": [
        ("D01", "突发胸痛，放射至左臂，出冷汗，含服硝酸甘油后缓解"),
        ("D02", "活动后气短，夜间不能平卧，双下肢水肿"),
        ("D03", "心悸伴手抖、多汗、体重下降"),
        ("D04", "发热三天，伴咳嗽、咳黄痰"),
        ("D05", "干咳两周，无发热，夜间加重"),
        ("D06", "持续性头痛，伴恶心、畏光"),
        ("D07", "上腹痛，饭后加重，反酸"),
        ("D08", "明显乏力，食欲下降，体重减轻"),
        ("D09", "胸闷、气短，快走时加重"),
        ("D10", "咳嗽伴低热、夜间盗汗"),
    ],
    "case02": [
        ("D01", "胸痛反复发作，劳累后明显，休息可缓解"),
        ("D02", "气短两月，爬两层楼即喘"),
        ("D03", "心悸，夜间明显，伴多汗"),
        ("D04", "发热伴咳嗽一周，痰少"),
        ("D05", "咳嗽三周，干咳为主，无发热"),
        ("D06", "头痛反复，午后加重"),
        ("D07", "腹痛伴反酸，进食后明显"),
        ("D08", "乏力半年，活动耐力下降"),
        ("D09", "胸部不适伴心慌，偶有气短"),
        ("D10", "发热、乏力，伴咳嗽"),
    ],
}

QUERIES = {
    "case01": [
        ("q1", "胸痛伴出汗", "same_words"),
        ("q2", "喘不上气，晚上躺不平", "paraphrase"),
        ("q3", "皮疹瘙痒两周", "irrelevant"),
    ],
    "case02": [
        ("q1", "胸闷、心慌", "same_words"),
        ("q2", "没力气，活动就喘", "paraphrase"),
        ("q3", "牙龈出血三天", "irrelevant"),
    ],
}


def vectorize(text, concepts):
    s = text
    for word in sorted(concepts["synonyms"], key=len, reverse=True):
        s = s.replace(word, concepts["synonyms"][word])
    return [s.count(name) for name in concepts["concepts"]]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def expected_for(name):
    docs = DOCS[name]
    queries = QUERIES[name]
    dv = {doc_id: vectorize(text, CONCEPTS) for doc_id, text in docs}
    retrieval = []
    for qid, text, kind in queries:
        qv = vectorize(text, CONCEPTS)
        scored = [{"doc_id": d, "score": round(cosine(qv, dv[d]), 4)} for d, _ in docs]
        scored = [s for s in scored if s["score"] > 0]
        scored.sort(key=lambda s: (-s["score"], s["doc_id"]))
        retrieval.append({"query_id": qid, "kind": kind, "top_k": scored[:3]})
    return {"index": {"dim": CONCEPTS["dim"], "n_docs": len(docs)}, "retrieval": retrieval}


def main():
    for name in DOCS:
        case = CASES / name
        case.mkdir(parents=True, exist_ok=True)
        with (case / "docs.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["doc_id", "text"])
            w.writerows(DOCS[name])
        with (case / "queries.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["query_id", "text", "kind"])
            w.writerows(QUERIES[name])
        (case / "concepts.json").write_text(json.dumps(CONCEPTS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        exp = expected_for(name)
        (case / "expected.json").write_text(json.dumps(exp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{name}: {len(DOCS[name])} 篇文档 / {len(QUERIES[name])} 条查询")


if __name__ == "__main__":
    main()
