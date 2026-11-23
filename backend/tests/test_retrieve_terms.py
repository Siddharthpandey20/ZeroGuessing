"""Question words must match their inflections in the documents ("conclusions" -> "Conclusion").

The full-text index uses Postgres' 'simple' config (no stemming, so Hindi and figures index verbatim), which made
"explain the conclusions of both papers" miss both papers' "Conclusion" sections."""

from app.core.retrieve import rrf, stem, tsquery


def test_weighted_fusion_lets_meaning_search_lead():
    dense = [("a", 0.9), ("b", 0.8), ("c", 0.7)]
    keyword = [("c", 5.0), ("b", 4.0)]
    assert rrf(dense, keyword)[2] == "a"  # equal weights: keyword agreement lifts b and c over a
    assert rrf(dense, keyword, weights=[1.0, 0.3])[0] == "b"  # still rewarded when both agree
    assert rrf(dense, [("z", 1.0)], weights=[1.0, 0.3]) == ["a", "b", "c", "z"]  # a keyword-only hit can't jump the top


def test_plural_and_verb_forms_reduce_to_a_shared_prefix():
    assert stem("conclusions") == "conclusion"
    assert "conclusion".startswith(stem("conclusions"))
    assert stem("evaluated") == stem("evaluating") == "evaluat"
    assert stem("policies") == "polic"
    assert stem("charges") == "charg"
    assert stem("results") == "result"


def test_short_words_numbers_and_non_latin_are_left_alone():
    for t in ("fee", "7.2", "₹5,000", "2026", "गृह", "rbi"):
        assert stem(t) == t


def test_tsquery_uses_prefix_match_only_for_stemmed_words():
    q = tsquery(["conclusions", "7.2", "fee"])
    assert q == "conclusion:* | 7.2 | fee"
    assert tsquery(["", "%"]) == ""
