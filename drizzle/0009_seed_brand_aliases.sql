-- Append real brand/merchant names as aliases so both the fuzzy matcher
-- (findCategory: exact / prefix / first-word / Levenshtein) and the AI classifier
-- route by store name — especially auto-imported bank pushes, whose subcategory is
-- the raw merchant string. Aliases are lowercased at match time; kept lowercase here.
--
-- ЖКХ carries the literal token "ypdomylandsbp" (Domyland/Домиленд via СБП): the
-- matcher is prefix-anchored and the bank glues the merchant as "ypdomylandsbp…",
-- so the plain "domyland" alias alone would not fuzzy-match — the exact token makes
-- future такие пуши land in ЖКХ deterministically (score ≥ CONFIDENT_SCORE).
--
-- Idempotent: merges brands into the existing set (deduped) and skips a category
-- once it already contains all of them (@> guard). New categories added later must
-- ship their own brand aliases.

UPDATE "categories" AS c
SET "aliases" = ARRAY(SELECT DISTINCT e FROM unnest(c."aliases" || v.brands) AS e)
FROM (VALUES
  ('Продукты', ARRAY['пятёрочка','перекрёсток','ярче','вкусвилл','лента','ашан','дикси','окей','spar','магнолия','самокат']),
  ('Здоровье (врачи и процедуры)', ARRAY['инвитро','гемотест','ситилаб','кдл','стоматология','поликлиника','медцентр']),
  ('Кафе, доставка, фастфуд', ARRAY['яндекс еда','delivery club','додо пицца','kfc','бургер кинг','вкусно и точка','папа джонс','теремок','шоколадница','ростикс','жар-пицца']),
  ('Ремонт машины и эксплуатация', ARRAY['шиномонтаж','автозапчасти','замена масла','колёса','запчасти','exist']),
  ('Аптека', ARRAY['ригла','горздрав','апрель','здравсити','еаптека','планета здоровья','максавит','асна']),
  ('Путешествия и билеты', ARRAY['яндекс путешествия','островок','ostrovok','booking','aviasales','туту','ржд','аэрофлот','победа','s7','onetwotrip']),
  ('Бензин и расходники на машину', ARRAY['лукойл','газпромнефть','роснефть','shell','татнефть','нефтьмагистраль','teboil','автодор']),
  ('Спорт взрослых', ARRAY['world class','x-fit','ddx fitness','alex fitness','fitness house','зебра фитнес']),
  ('Кружки и секции детей', ARRAY['музыкальная школа','художественная школа','футбольная школа','робототехника','танцы']),
  ('Сервисы, интернет, связь', ARRAY['мтс','билайн','мегафон','tele2','yota','ростелеком','timeweb','selectel','reg.ru','patreon','netflix','spotify','яндекс плюс','кинопоиск','okko','ivi','chatgpt','openai','icloud','литрес']),
  ('ЖКХ', ARRAY['domyland','домиленд','ypdomylandsbp','энергосбыт','мосэнергосбыт','еирц','гис жкх','водоканал','тнс энерго','теплосеть','жку']),
  ('Такси', ARRAY['яндекс такси','ситимобил','максим такси','indriver','uber','wheely']),
  ('Ипотека', ARRAY['домклик','ипотечный платеж']),
  ('Развлечения (кино, театр)', ARRAY['каро','синема парк','формула кино','кинотеатр','мультиплекс','аквапарк','зоопарк','музей','выставка','батутный центр']),
  ('Услуги (стрижка, эпиляция)', ARRAY['барбершоп','шугаринг','лазерная эпиляция','солярий','парикмахерская','химчистка','ателье','ремонт обуви','ремонт часов','ногтевая студия','брови']),
  ('Хобби', ARRAY['skillbox','нетология','coursera','stepik','udemy','geekbrains','мастер-класс','вебинар','репетитор']),
  ('Ремонт и обустройство квартиры', ARRAY['леруа мерлен','obi','петрович','всеинструменты','hoff','ikea','максидом','аскона','сантехника','плитка']),
  ('Детские товары', ARRAY['детский мир','дочки-сыночки','кораблик','mothercare','антошка','буду мамой','lego']),
  ('Товары для дома', ARRAY['фикс прайс','fix price','улыбка радуги','галамарт','посуда центр','сима-ленд']),
  ('Одежда и обувь', ARRAY['zara','h&m','uniqlo','ostin','gloria jeans','lamoda','kari','спортмастер','befree','снежная королева','ecco','decathlon','respect','sela']),
  ('Товары для красоты', ARRAY['золотое яблоко','летуаль','рив гош','магнит косметик','подружка','ив роше','faberlic','oriflame','avon','nyx']),
  ('Дача', ARRAY['садовод','садовый центр','все для дачи','газонокосилка','удобрения','саженцы','парник'])
) AS v(name, brands)
WHERE c."name" = v.name AND NOT (c."aliases" @> v.brands);
