// Kitchen tools shown in step-by-step cook mode, so nobody has to remember what a skillet is.
// Order matters: specific tools come before generic ones ("frying pan" before "pan", "dutch oven" before "oven").
// Each match is blanked out before the next tool is checked, and `replaces` hides a more generic tool
// ("Blend with a stick blender" shows only the stick blender). Icons are 24×24 line drawings using currentColor.
const KITCHEN_TOOLS = [
  { id: 'air-fryer', name: 'Air fryer', description: 'A countertop hot-air oven with a pull-out basket.',
    pattern: /\bair\s?fryer|\bairfryer/i,
    svg: '<rect x="5" y="2.5" width="14" height="19" rx="4"/><circle cx="12" cy="7.5" r="2"/><path d="M5 12.5h14M10 16h4"/>' },
  { id: 'stick-blender', name: 'Stick blender', description: 'A hand-held blender you dip straight into the pot or bowl.', replaces: ['blender'],
    pattern: /\b(?:stick|hand|immersion)\s+blender|\bstaafmixer/i,
    svg: '<rect x="9" y="2" width="6" height="9" rx="2.5"/><path d="M12 11v7.5M8.5 22c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5Z"/><path d="M11 5h2"/>' },
  { id: 'food-processor', name: 'Food processor', description: 'A bowl with a spinning blade for chopping and mixing fast.',
    pattern: /\bfood\s*processor|\bkeukenmachine/i,
    svg: '<rect x="5" y="16" width="14" height="5.5" rx="1.5"/><path d="M6 7.5h12V16H6Z"/><path d="M14.5 7.5V3.5h3v4M9 12h6"/><circle cx="12" cy="18.75" r=".6"/>' },
  { id: 'blender', name: 'Blender', description: 'A tall jug with blades in the bottom for smooth soups and drinks.',
    pattern: /\bblend(?:er|ed|ing)?\b|\bpureren\b/i,
    svg: '<path d="M5.5 3h13M6.5 3l1.5 13h8l1.5-13"/><rect x="7" y="16" width="10" height="5.5" rx="1.5"/><path d="M10 12.5h4"/><circle cx="12" cy="18.75" r=".6"/>' },
  { id: 'hand-mixer', name: 'Hand mixer', description: 'An electric beater with two whisks for batter and cream.',
    pattern: /\b(?:hand|electric|stand)?\s*mixer\b|\bmixen\b/i,
    svg: '<path d="M4 5.5h10.5A4.5 4.5 0 0 1 19 10H8.5A4.5 4.5 0 0 1 4 5.5Z"/><path d="M6 5.5 8 3h5l1.5 2.5M10 10v6.5a1.25 1.25 0 0 0 2.5 0V10M14 10v6.5a1.25 1.25 0 0 0 2.5 0V10"/>' },
  { id: 'whisk', name: 'Whisk', description: 'Loops of wire on a handle for beating eggs or cream.',
    pattern: /\bwhisk|\bgarde\b|\bklop(?:t|pen)?\b|\bopkloppen/i,
    svg: '<path d="M12 22v-8M12 14C8 12 7 8.5 8 5a4 4 0 0 1 8 0c1 3.5 0 7-4 9Z"/><path d="M12 14c-1.3-2.5-1.8-6.5-.9-12.8M12 14c1.3-2.5 1.8-6.5.9-12.8"/>' },
  { id: 'grill-pan', name: 'Grill pan', description: 'A heavy pan with ridges that gives food grill stripes.',
    pattern: /\bgrill\s*pan|\bgrillpan|\bgriddle/i,
    svg: '<rect x="2" y="5.5" width="13" height="13" rx="2"/><path d="M5 12.5l4.5-4.5M5 16l8-8M8.5 16l3.5-3.5M15 12h7"/>' },
  { id: 'wok', name: 'Wok', description: 'A deep, round-bottomed pan for stir-frying on high heat.',
    pattern: /\bwok\b/i,
    svg: '<path d="M2.5 9.5h17a8.5 7 0 0 1-17 0Z"/><path d="M19.5 9.5 23 7.5M2.5 9.5H1"/>' },
  { id: 'dutch-oven', name: 'Dutch oven', description: 'A heavy pot with a lid that can go on the stove and in the oven.',
    pattern: /\bdutch\s+oven|\bcasserole(?!\s+dish)|\bbraadpan|\bstoofpan|\bcast[- ]iron\s+pot|\bgietijzeren\s+pan/i,
    svg: '<path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/><path d="M4 12.5a1.75 1.75 0 0 1 0 3.5M20 12.5a1.75 1.75 0 0 0 0 3.5M3 11c0-2.5 4-4 9-4s9 1.5 9 4M11 7V5.2h2V7"/>' },
  { id: 'stock-pot', name: 'Large pot', description: 'A big, deep pot with two handles for soup, pasta and boiling.',
    pattern: /\bstock\s*pot|\b(?:large|big|soup|pasta|deep)\s+(?:pot|pan)\b|\bpot\b|\bkookpan|\bsoeppan|\bgrote\s+pan/i,
    svg: '<path d="M4.5 6h15v12a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3Z"/><path d="M4.5 8.5H2.5M19.5 8.5h2M3.5 6h17"/>' },
  { id: 'saucepan', name: 'Saucepan', description: 'A small, deep pan with one long handle for sauces and boiling.',
    pattern: /\bsauce\s*pan|\bsteelpan|\bpannetje/i,
    svg: '<path d="M3 8h11v8.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M2 8h13M14 10h8"/>' },
  { id: 'skillet', name: 'Frying pan (skillet)', description: 'A wide, shallow pan with sloped sides and a long handle, for frying.',
    pattern: /\bskillet|\bfrying\s*pan|\bfry\s*pan|\bsaute\s*pan|\bkoekenpan|\bhapjespan|\bpan\b/i,
    svg: '<path d="M1.5 11.5h15l-1.4 4.4a2.2 2.2 0 0 1-2.1 1.6H5a2.2 2.2 0 0 1-2.1-1.6Z"/><path d="M16.5 12.5 22.5 10"/>' },
  { id: 'baking-dish', name: 'Oven dish', description: 'A deep ovenproof dish for bakes, gratins and lasagne.',
    pattern: /\bbaking\s+dish|\boven\s*(?:proof\s+)?dish|\bovenschaal|\bcasserole\s+dish|\bgratin\s+dish|\blasagn[ae]\s+dish/i,
    svg: '<path d="M4 10h16v5.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/><path d="M4 11.5H2M20 11.5h2M3 10h18M7 13.5c1.2-1 2.3-1 3.3 0s2.3 1 3.4 0 2.2-1 3.3 0"/>' },
  { id: 'cake-tin', name: 'Cake tin', description: 'A deep round or loaf-shaped tin for baking cakes and bread.',
    pattern: /\b(?:cake|loaf|bread)\s+(?:tin|pan)|\bspringform|\bbakvorm|\bspringvorm|\bcakevorm/i,
    svg: '<ellipse cx="12" cy="7.5" rx="9" ry="3"/><path d="M3 7.5v8.5c0 1.7 4 3 9 3s9-1.3 9-3V7.5M21 12h1.5"/>' },
  { id: 'muffin-tin', name: 'Muffin tin', description: 'A tray with cups for muffins and cupcakes.',
    pattern: /\b(?:muffin|cupcake)\s+(?:tin|pan|tray)|\bmuffinvorm/i,
    svg: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="7" cy="9.5" r="2"/><circle cx="12" cy="9.5" r="2"/><circle cx="17" cy="9.5" r="2"/><circle cx="7" cy="14.5" r="2"/><circle cx="12" cy="14.5" r="2"/><circle cx="17" cy="14.5" r="2"/>' },
  { id: 'baking-tray', name: 'Baking tray', description: 'A flat metal tray that goes in the oven.',
    pattern: /\bbaking\s+(?:tray|sheet)|\bsheet\s+pan|\boven\s+tray|\broasting\s+(?:tray|tin|pan)|\bbakplaat|\bbakblik|\btray\b/i,
    svg: '<path d="M4.5 7.5h15l2.5 8.5H2Z"/><path d="M2 16v1.5h20V16"/><circle cx="8.5" cy="11.5" r="1.3"/><circle cx="14" cy="11.5" r="1.3"/>' },
  { id: 'baking-paper', name: 'Baking paper / foil', description: 'Non-stick paper or foil to line a tray or cover a dish.',
    pattern: /\bbaking\s+paper|\bparchment|\bbakpapier|\b(?:aluminium|aluminum|tin)\s*foil|\baluminiumfolie|\bfoil\b/i,
    svg: '<ellipse cx="5" cy="9" rx="2.5" ry="3.5"/><path d="M5 5.5h14a2.5 3.5 0 0 1 0 7H5M8 12.5v8h11v-8"/>' },
  { id: 'microwave', name: 'Microwave', description: 'Heats food fast with a turning plate inside.',
    pattern: /\bmicrowave|\bmagnetron/i,
    svg: '<rect x="2" y="5" width="20" height="14" rx="2"/><rect x="4.5" y="7.5" width="11" height="9" rx="1"/><path d="M18 5v14M19.5 12.5h1M19.5 15h1"/><circle cx="20" cy="9" r=".7"/>' },
  { id: 'oven', name: 'Oven', description: 'Bakes and roasts with dry heat. Heat it up before the food goes in.',
    pattern: /\boven|\bpreheat|\bvoorverwarm/i,
    svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M8.5 13.5h7"/><rect x="7" y="11" width="10" height="7" rx="1"/><circle cx="7" cy="5.5" r=".7"/><circle cx="10.5" cy="5.5" r=".7"/>' },
  { id: 'kettle', name: 'Kettle', description: 'Boils water quickly, handy to get pasta or rice water going.',
    pattern: /\bkettle|\bwaterkoker/i,
    svg: '<path d="M7 9h9l1.5 11H5.5Z"/><path d="M8 9a3.5 2.5 0 0 1 7 0M11.5 6.5V5M17 11.5h1.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H17.8M6.8 11.5 3 8.5"/>' },
  { id: 'colander', name: 'Colander', description: 'A bowl with holes for draining pasta, vegetables or beans.',
    pattern: /\bcolander|\bvergiet|\bdrain|\bafgieten|\bgiet\b[^.]{0,25}\baf\b|\buitlekken/i,
    svg: '<path d="M3 9.5h18l-1.7 6.3a4 4 0 0 1-3.9 3H8.6a4 4 0 0 1-3.9-3Z"/><path d="M3 9.5H1.5M21 9.5h1.5M9.5 18.8v2h5v-2M8 12.5h.01M12 12.5h.01M16 12.5h.01M10 15.3h.01M14 15.3h.01"/>' },
  { id: 'sieve', name: 'Sieve', description: 'A fine mesh strainer on a handle, for sifting flour or straining sauces.',
    pattern: /\bsieve|\bstrainer|\bstrain\b|\bsift|\bzeef|\bzeven\b/i,
    svg: '<path d="M2 9.5h12a6 6 0 0 1-12 0Z"/><path d="M14 9.5h8M5 12h.01M8 12h.01M11 12h.01M6.5 14.2h.01M9.5 14.2h.01"/>' },
  { id: 'ladle', name: 'Ladle', description: 'A deep spoon on a long handle for scooping soup.',
    pattern: /\bladle|\bsoeplepel|\bopscheplepel|\bpollepel/i,
    svg: '<path d="M3 13h10a5 5 0 0 1-10 0Z"/><path d="M12.5 13 15.4 3.6c.3-1 1.5-1.4 2.4-.8"/>' },
  { id: 'spoon', name: 'Wooden spoon', description: 'A sturdy spoon for stirring hot food without scratching the pan.',
    pattern: /\b(?:wooden|slotted|mixing|large)\s+spoon|\bhouten\s+lepel|\bschuimspaan/i,
    svg: '<ellipse cx="12" cy="6.5" rx="3.5" ry="4.5"/><path d="M12 11v11"/>' },
  { id: 'spatula', name: 'Spatula', description: 'A flat, wide turner for flipping pancakes, eggs and burgers.',
    pattern: /\bspatula|\bturner\b|\bflip\b|\bspatel|\bbakspaan|\bomdraaien|\b(?:draai|keer)\b[^.]{0,25}\bom\b/i,
    svg: '<rect x="8" y="2" width="8" height="9" rx="1.5"/><path d="M10.5 4.5v4M13.5 4.5v4M12 11v3"/><rect x="10.8" y="14" width="2.4" height="8" rx="1.2"/>' },
  { id: 'tongs', name: 'Tongs', description: 'Two linked arms for grabbing and turning hot food.',
    pattern: /\btongs\b|\bkeukentang|\btang\b/i,
    svg: '<circle cx="12" cy="3" r="1.3"/><path d="M11.2 4 6.5 20M12.8 4l4.7 16M5 20.5h3M16 20.5h3"/>' },
  { id: 'knife', name: "Chef's knife", description: 'A large, sharp knife for chopping, slicing and dicing.',
    pattern: /\bknife|\bchop|\bdice|\bdiced|\bmince|\bslice|\bcut\b|\bmes\b|\bsnijd|\bsnij\b|\bsnipper|\bhak\b|\bhakken|\bin\s+stukjes/i,
    svg: '<path d="M14 9v4.5H4.5C3 13.5 2 12.8 2 12c3-1.8 7-3 12-3Z"/><rect x="14" y="10" width="8" height="3" rx="1.2"/>' },
  { id: 'cutting-board', name: 'Cutting board', description: 'A board to chop on, so you do not cut the counter.',
    pattern: /\b(?:cutting|chopping)\s+board|\bsnijplank/i,
    svg: '<path d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2h2.5a1.5 1.5 0 0 1 0 3H18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>' },
  { id: 'grater', name: 'Grater', description: 'A box or flat grater for cheese, zest and vegetables.',
    pattern: /\bgrat(?:er|e|ed|ing)\b|\bzest|\brasp\b|\braspen\b|\bgeraspt/i,
    svg: '<path d="M7 5h10l2 16H5Z"/><path d="M9 5V2.5h6V5M9.5 9h.01M12 9h.01M14.5 9h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M8.7 16h.01M12 16h.01M15.3 16h.01"/>' },
  { id: 'peeler', name: 'Peeler', description: 'Takes a thin skin off potatoes, carrots and apples.',
    pattern: /\bpeeler|\bdunschiller|\bpeel\b|\bschil\b|\bschillen\b/i,
    svg: '<path d="M12 22v-8.5M12 13.5 8 5M12 13.5l4-8.5M7.5 5h9"/>' },
  { id: 'masher', name: 'Masher', description: 'A zigzag wire on a handle for mashing potatoes or beans.',
    pattern: /\bmasher|\bmash|\bstamper|\bstamp\b|\bprak/i,
    svg: '<rect x="10.5" y="2" width="3" height="6" rx="1.5"/><path d="M12 8v6M6 14h12M6 14v3M18 14v3M6 17l2 4 2-4 2 4 2-4 2 4 2-4"/>' },
  { id: 'mortar', name: 'Mortar and pestle', description: 'A heavy bowl and stick for crushing spices and garlic.',
    pattern: /\bmortar|\bpestle|\bvijzel/i,
    svg: '<path d="M4 12h16a8 7 0 0 1-16 0Z"/><path d="M9 19.5h6M13.5 11.5l6-7a1.4 1.4 0 0 1 2 2l-6 6"/>' },
  { id: 'rolling-pin', name: 'Rolling pin', description: 'A roller for flattening dough.',
    pattern: /\brolling\s+pin|\broll\s+(?:it\s+|the\s+dough\s+)?out|\bdeegroller|\buitrollen/i,
    svg: '<rect x="5" y="9.5" width="14" height="5" rx="2.5"/><path d="M5 12H2M19 12h3"/>' },
  { id: 'bowl', name: 'Mixing bowl', description: 'A big bowl for mixing, whisking or resting dough.',
    pattern: /\bbowl|\bkom\b|\bbeslagkom|\bmengkom/i,
    svg: '<path d="M2 10.5h20M3 10.5h18a9 8 0 0 1-18 0Z"/><path d="M9 19.5h6"/>' },
  { id: 'measuring-jug', name: 'Measuring jug', description: 'A jug with lines on the side to measure liquids.',
    pattern: /\bmeasuring\s+(?:jug|cup)|\bmaatbeker/i,
    svg: '<path d="M5 4h11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><path d="M5 4 3.5 6M16 7h1.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H16M5 8.5h3M5 11.5h2M5 14.5h3"/>' },
  { id: 'scale', name: 'Kitchen scale', description: 'Weighs ingredients in grams.',
    pattern: /\bkitchen\s+scale|\bscales?\b|\bweigh|\bweegschaal|\bafwegen/i,
    svg: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M5 6.5h14M12 6.5V9"/><circle cx="12" cy="14.5" r="3"/><path d="M12 14.5l1.5-1.5"/>' },
  { id: 'lid', name: 'Lid', description: 'Covers the pan to keep heat and steam in.',
    pattern: /\blid\b|\bcover(?:ed)?\b|\bdeksel|\bafdekken|\bdek\b[^.]{0,25}\baf\b/i,
    svg: '<path d="M3 16h18M4 16a8 7 0 0 1 16 0"/><rect x="10.5" y="6.5" width="3" height="2.5" rx="1"/>' },
];

// Tools mentioned in a piece of recipe text, in the order they first appear.
function kitchenToolsIn(text) {
  let remaining = String(text || '');
  const found = [];
  for (const tool of KITCHEN_TOOLS) {
    const pattern = new RegExp(tool.pattern.source, 'gi');
    let first = -1;
    remaining = remaining.replace(pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2];
      if (first < 0) first = offset;
      return ' '.repeat(match.length);
    });
    if (first >= 0) found.push({ tool, first });
  }
  const replaced = new Set(found.flatMap((entry) => entry.tool.replaces || []));
  return found.filter((entry) => !replaced.has(entry.tool.id)).sort((a, b) => a.first - b.first).map((entry) => entry.tool);
}

function kitchenToolIcon(tool, className = 'tool-icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${tool.svg}</svg>`;
}
