"""Link import: SSRF guard and page fact extraction."""
import pytest

from app.assistant import link_import as li


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://localhost/x", "ftp://example.com/x", "http://10.0.0.5/", "http://169.254.169.254/latest"])
def test_blocks_private_and_odd_urls(url):
    with pytest.raises(li.LinkError):
        li._check_host(url)


def test_extract_prefers_jsonld_product():
    page = """<html><head><title>Shop | X</title>
    <meta property="og:image" content="/img/a.jpg">
    <script type="application/ld+json">{"@type":"Product","name":"Baseus 20W Charger","brand":{"name":"Baseus"},
      "description":"Fast PD charger","offers":{"price":"1290","priceCurrency":"BDT"}}</script></head>
    <body><nav>menu</nav><p>Great charger</p></body></html>"""
    f = li.extract("https://shop.example.com/p/1", page)
    assert f["title"] == "Baseus 20W Charger" and f["brand"] == "Baseus" and f["price"] == "1290"
    assert f["image_url"] == "https://shop.example.com/img/a.jpg"
    assert "Great charger" in f["text"] and "menu" not in f["text"]
    d = li.normalize_draft({}, f)
    assert d["name_en"] == "Baseus 20W Charger" and d["description_en"] == "Fast PD charger"
