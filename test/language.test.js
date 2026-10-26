const test = require("node:test");
const assert = require("node:assert");

const {detectLanguage} = require("../dist/core/text/language.js");

const code = (text) => detectLanguage(text)?.code ?? null;

test("common Latin-script languages are told apart by their function words", () => {
	assert.strictEqual(code("Vandaag gebeld met het energiebedrijf over de eindafrekening. Er staat nog een bedrag open, maar dat klopt niet."), "nl");
	assert.strictEqual(code("Helm is a package manager for Kubernetes, and the most common use that I have seen is for templating."), "en");
	assert.strictEqual(code("Heute habe ich mit Anna über den Sauerteig gesprochen, und sie sagt, dass er nicht genug Wasser hat."), "de");
	assert.strictEqual(code("Aujourd'hui je suis allé au marché avec ma sœur et nous avons acheté des pommes pour le dessert."), "fr");
	assert.strictEqual(code("Hoy fui al mercado con mi hermana y compramos manzanas para el postre, pero los precios estaban muy altos."), "es");
});

test("languages with a script of their own are recognised by it", () => {
	assert.strictEqual(code("今日はとても良い天気でした。公園を散歩しました。"), "ja");
	assert.strictEqual(code("오늘은 날씨가 정말 좋았습니다. 공원을 산책했습니다."), "ko");
	assert.strictEqual(code("今天天气很好，我们去公园散步了。"), "zh");
});

test("no hint when it can't tell confidently", () => {
	assert.strictEqual(code("Сегодня была хорошая погода, и мы гуляли в парке."), null, "Cyrillic is several languages");
	assert.strictEqual(code("Kubernetes Helm charts"), null, "too few function words");
	assert.strictEqual(code(""), null);
});
