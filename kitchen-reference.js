// Reference data for the Tools tab: the unit converter and the cooking terms explained.

// Units by kind. Factors are to grams (mass) or millilitres (volume). Cups, tablespoons and teaspoons are the
// common kitchen sizes (240 ml cup, 15 ml tablespoon, 5 ml teaspoon), the same ones the recipes use.
const CONVERTER_UNITS = [
  { id: 'g', label: 'grams (g)', kind: 'mass', factor: 1 },
  { id: 'kg', label: 'kilograms (kg)', kind: 'mass', factor: 1000 },
  { id: 'oz', label: 'ounces (oz)', kind: 'mass', factor: 28.3495 },
  { id: 'lb', label: 'pounds (lb)', kind: 'mass', factor: 453.592 },
  { id: 'ml', label: 'millilitres (ml)', kind: 'volume', factor: 1 },
  { id: 'cl', label: 'centilitres (cl)', kind: 'volume', factor: 10 },
  { id: 'dl', label: 'decilitres (dl)', kind: 'volume', factor: 100 },
  { id: 'l', label: 'litres (l)', kind: 'volume', factor: 1000 },
  { id: 'tsp', label: 'teaspoons (tsp)', kind: 'volume', factor: 5 },
  { id: 'tbsp', label: 'tablespoons (tbsp)', kind: 'volume', factor: 15 },
  { id: 'cup', label: 'cups', kind: 'volume', factor: 240 },
  { id: 'floz', label: 'fluid ounces (fl oz)', kind: 'volume', factor: 29.5735 },
  { id: 'pint', label: 'pints (US)', kind: 'volume', factor: 473.176 },
];

// Grams per millilitre, to go between weight and volume ("1 cup of flour is about 125 g").
// Typical values for spooned-and-levelled dry goods; real weights vary a little.
const CONVERTER_INGREDIENTS = [
  { id: 'water', label: 'Water, milk, stock', density: 1 },
  { id: 'flour', label: 'Flour', density: 0.53 },
  { id: 'sugar', label: 'Sugar (white)', density: 0.83 },
  { id: 'brown-sugar', label: 'Brown sugar (packed)', density: 0.92 },
  { id: 'icing-sugar', label: 'Icing sugar', density: 0.5 },
  { id: 'butter', label: 'Butter', density: 0.95 },
  { id: 'oil', label: 'Oil', density: 0.91 },
  { id: 'honey', label: 'Honey, syrup', density: 1.42 },
  { id: 'rice', label: 'Rice (uncooked)', density: 0.77 },
  { id: 'oats', label: 'Rolled oats', density: 0.38 },
  { id: 'cocoa', label: 'Cocoa powder', density: 0.35 },
  { id: 'salt', label: 'Salt (fine)', density: 1.2 },
  { id: 'cheese', label: 'Grated cheese', density: 0.42 },
];

// Oven temperatures: gas mark ↔ °C (conventional oven).
const GAS_MARKS = [[0.25, 110], [0.5, 120], [1, 140], [2, 150], [3, 170], [4, 180], [5, 190], [6, 200], [7, 220], [8, 230], [9, 240]];

// Cooking terms explained simply, in English and Dutch. The video button opens a YouTube search for the technique.
const COOKING_TERMS = [
  { en: 'Al dente', nl: 'Al dente', what: 'Pasta (or vegetables) cooked until just done: soft outside, with a little bite in the middle. Taste one a minute before the packet time.' },
  { en: 'Bain-marie', nl: 'Au bain-marie', what: 'A bowl set over (not in) a pan of gently simmering water. The steam heats it softly, for melting chocolate or making sauces without burning them.' },
  { en: 'Baste', nl: 'Bedruipen', what: 'Spooning hot fat or juices over meat while it cooks, so it stays moist and browns evenly.' },
  { en: 'Beat', nl: 'Kloppen', what: 'Mixing fast with a whisk, fork or mixer to add air, for example eggs or cream.' },
  { en: 'Blanch', nl: 'Blancheren', what: 'Cooking vegetables very briefly in boiling water, then putting them straight into ice-cold water. They stay bright and crisp.' },
  { en: 'Blind bake', nl: 'Blind bakken', what: 'Baking a pastry case empty first, weighed down with baking paper and dried beans, so the bottom stays crisp under a wet filling.' },
  { en: 'Boil', nl: 'Koken', what: 'Heating liquid until big bubbles break the surface all the time (100 °C for water).' },
  { en: 'Braise', nl: 'Stoven / smoren', what: 'Browning food first, then cooking it slowly with a lid on in a little liquid until very tender.' },
  { en: 'Caramelize', nl: 'Karameliseren', what: 'Heating sugar, or foods like onions, until they turn golden brown and sweet.' },
  { en: 'Chop', nl: 'Hakken', what: 'Cutting into rough pieces of about the same size. Size does not need to be exact.' },
  { en: 'Cream (butter and sugar)', nl: 'Luchtig kloppen', what: 'Beating soft butter and sugar together until pale and fluffy. It traps air and makes cakes light.' },
  { en: 'Deglaze', nl: 'Blussen / deglaceren', what: 'Pouring liquid (wine, stock, water) into a hot pan after frying and scraping up the brown bits. They make the base of a sauce.' },
  { en: 'Dice', nl: 'In blokjes snijden', what: 'Cutting into small, even cubes. Even pieces cook at the same speed.' },
  { en: 'Emulsify', nl: 'Emulgeren / binden', what: 'Whisking oil into a liquid (like vinegar or egg yolk) slowly so they blend into a smooth sauce instead of separating, as in mayonnaise or vinaigrette.' },
  { en: 'Fold', nl: 'Spatelen / onderscheppen', what: 'Gently mixing with a spatula in a scooping motion from the bottom, so you keep the air in whipped eggs or cream.' },
  { en: 'Julienne', nl: 'Julienne', what: 'Cutting into thin matchsticks, about 5 cm long.' },
  { en: 'Knead', nl: 'Kneden', what: 'Pressing, folding and turning dough with your hands until it is smooth and stretchy. It builds the structure of bread.' },
  { en: 'Marinate', nl: 'Marineren', what: 'Leaving food in a seasoned liquid (oil, acid, herbs, spices) for a while so it takes on flavour, and meat becomes more tender.' },
  { en: 'Mince', nl: 'Fijnhakken', what: 'Chopping very finely, almost to a paste, often used for garlic, ginger and herbs.' },
  { en: 'Parboil', nl: 'Voorkoken', what: 'Boiling something partly, then finishing it another way, like potatoes before roasting.' },
  { en: 'Poach', nl: 'Pocheren', what: 'Cooking gently in liquid that barely moves (just under a simmer), for eggs, fish or fruit.' },
  { en: 'Preheat', nl: 'Voorverwarmen', what: 'Turning the oven on before you need it, so it is fully hot when the food goes in. Usually 10–15 minutes.' },
  { en: 'Proof (rise)', nl: 'Laten rijzen', what: 'Leaving yeast dough somewhere warm until it has grown, often to about double its size.' },
  { en: 'Reduce', nl: 'Inkoken', what: 'Simmering a liquid without a lid so water evaporates. The sauce gets thicker and the taste stronger.' },
  { en: 'Rest', nl: 'Laten rusten', what: 'Leaving meat for a few minutes after cooking before cutting (the juices settle), or leaving dough or batter to relax.' },
  { en: 'Roast', nl: 'Roosteren / braden in de oven', what: 'Cooking in a hot oven without a lid so the outside browns, for meat and vegetables.' },
  { en: 'Roux', nl: 'Roux', what: 'Equal parts butter and flour cooked together for a minute or two. Whisk in milk or stock to make a thick sauce.' },
  { en: 'Sauté', nl: 'Sauteren / aanbakken', what: 'Frying quickly in a little fat over fairly high heat, stirring or tossing often.' },
  { en: 'Score', nl: 'Inkerven', what: 'Making shallow cuts in the surface of meat, fish or bread so it cooks evenly, crisps up or opens nicely.' },
  { en: 'Sear', nl: 'Dichtschroeien', what: 'Browning the outside of meat quickly in a very hot pan for flavour and colour. Do not move it until it releases.' },
  { en: 'Season to taste', nl: 'Op smaak brengen', what: 'Adding salt, pepper or other flavourings bit by bit, tasting as you go, until it tastes right to you.' },
  { en: 'Simmer', nl: 'Sudderen / zachtjes laten koken', what: 'Cooking liquid on low heat with just small bubbles now and then. Gentler than boiling.' },
  { en: 'Sweat', nl: 'Glazig fruiten / zweten', what: 'Cooking vegetables like onion slowly in a little fat, often with a lid, until soft and see-through but not browned.' },
  { en: 'Temper', nl: 'Tempereren', what: 'Warming eggs slowly by whisking in a little of a hot liquid first so they do not scramble. For chocolate: melting and cooling it to set shiny.' },
  { en: 'Whisk', nl: 'Kloppen met een garde', what: 'Mixing with a wire whisk to blend smoothly or whip air in.' },
  { en: 'Zest', nl: 'Zesten / raspen', what: 'Finely grating the coloured outer skin of citrus fruit. Stop before the bitter white part.' },
];

function cookingTermVideoUrl(term) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${term.en.replace(/\s*\(.*\)$/, '')} cooking technique`)}`;
}
