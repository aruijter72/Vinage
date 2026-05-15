/* ═══════════════════════════════════════════════════════════════════════════
   Vinage — Partner Importers
   ═══════════════════════════════════════════════════════════════════════════
   To add a new importer, copy one entry and adjust the fields.
   Set active: false to hide an importer without deleting their data.

   Each wine entry needs a `pairings` array of food keywords.
   Include both English AND Dutch (and other languages) so dish-matching works
   regardless of what language the user types in.
   ═══════════════════════════════════════════════════════════════════════════ */

const IMPORTERS = [

  /* ── Okhuysen ─────────────────────────────────────────────────────────── */
  {
    id:      'okhuysen',
    name:    'Okhuysen',
    tagline: { nl: 'Aanbevolen door Okhuysen', en: 'Recommended by Okhuysen' },
    color:   '#7A2535',
    website: 'https://www.okhuysen.nl',
    active:  true,

    wines: [
      {
        name:       'Château Pichon Baron',
        producer:   'Château Pichon Baron',
        vintage:    2018,
        type:       'red',
        region:     'Pauillac, Bordeaux',
        grapes:     ['Cabernet Sauvignon', 'Merlot'],
        priceRange: '€65–80',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'beef', 'steak', 'ribeye', 'roast', 'lamb', 'venison', 'duck', 'game', 'truffle', 'cheese',
          // NL
          'biefstuk', 'entrecote', 'ossenhaas', 'rundvlees', 'rund', 'lam', 'lamsrack', 'lamsbout',
          'hertenvlees', 'wild', 'eend', 'truffel', 'kaas', 'gebraad', 'stoofvlees', 'braadstuk',
          // FR
          'boeuf', 'bourguignon', 'pot-au-feu', 'daube', 'entrecôte', 'canard', 'gibier', 'agneau',
          // IT
          'bistecca', 'manzo', 'arrosto', 'selvaggina', 'anatra', 'tartufo', 'brasato'
        ]
      },
      {
        name:       'Puligny-Montrachet 1er Cru',
        producer:   'Domaine Leflaive',
        vintage:    2020,
        type:       'white',
        region:     'Côte de Beaune, Burgundy',
        grapes:     ['Chardonnay'],
        priceRange: '€85–110',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'fish', 'seafood', 'lobster', 'scallop', 'sole', 'turbot', 'chicken', 'veal', 'cream', 'pasta', 'risotto', 'mushroom',
          // NL
          'vis', 'zeevruchten', 'kreeft', 'sint-jakobsschelp', 'tong', 'tarbot', 'kip', 'kalf', 'kalfsvlees',
          'room', 'slagroom', 'champignon', 'paddenstoel', 'pasta', 'risotto', 'zalm', 'forel',
          // FR
          'poisson', 'homard', 'coquille', 'saint-jacques', 'poulet', 'veau', 'crème', 'sole', 'turbot',
          // IT
          'pesce', 'astice', 'capesante', 'pollo', 'vitello', 'panna', 'funghi'
        ]
      },
      {
        name:       'Barolo Serralunga d\'Alba',
        producer:   'Giacomo Conterno',
        vintage:    2017,
        type:       'red',
        region:     'Barolo, Piedmont',
        grapes:     ['Nebbiolo'],
        priceRange: '€55–75',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'beef', 'stew', 'braised', 'ossobuco', 'risotto', 'truffle', 'mushroom', 'game', 'aged cheese', 'pasta',
          // NL
          'rundvlees', 'rund', 'stoofvlees', 'gestoofd', 'ossobuco', 'risotto', 'truffel',
          'paddenstoel', 'champignon', 'wild', 'pasta', 'belegen kaas',
          // FR
          'boeuf', 'bourguignon', 'daube', 'pot-au-feu', 'carbonnade', 'gibier', 'ragout',
          // IT
          'manzo', 'brasato', 'stufato', 'selvaggina', 'tartufo', 'funghi', 'osso buco'
        ]
      },
      {
        name:       'Sancerre Blanc',
        producer:   'Henri Bourgeois',
        vintage:    2022,
        type:       'white',
        region:     'Loire Valley',
        grapes:     ['Sauvignon Blanc'],
        priceRange: '€18–24',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'goat cheese', 'salad', 'asparagus', 'vegetables', 'oyster', 'seafood', 'fish', 'sushi', 'light', 'lemon', 'herb',
          // NL
          'geitenkaas', 'salade', 'asperges', 'groenten', 'oester', 'zeevruchten', 'vis', 'sushi',
          'licht', 'citroen', 'kruiden', 'tomaat', 'komkommer', 'frisse',
          // FR
          'chèvre', 'fromage', 'salade', 'asperges', 'légumes', 'huître', 'poisson', 'citron', 'herbes',
          // IT
          'capra', 'formaggio', 'insalata', 'asparagi', 'verdure', 'ostrica', 'pesce', 'limone'
        ]
      },
      {
        name:       'Rioja Gran Reserva',
        producer:   'CVNE Imperial',
        vintage:    2015,
        type:       'red',
        region:     'Rioja Alta',
        grapes:     ['Tempranillo', 'Graciano', 'Mazuelo'],
        priceRange: '€28–38',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'lamb', 'pork', 'roast', 'tapas', 'chorizo', 'paella', 'stew', 'beef', 'aged cheese',
          // NL
          'lam', 'lamsrack', 'lamskotelet', 'varken', 'varkensvlees', 'varkenshaas',
          'gebraad', 'stoofvlees', 'worst', 'belegen kaas', 'rund', 'biefstuk',
          // FR
          'agneau', 'porc', 'boeuf', 'bourguignon', 'daube', 'carbonnade', 'cochon',
          // IT
          'agnello', 'maiale', 'manzo', 'brasato', 'arrosto'
        ]
      },
      {
        name:       'Chablis Premier Cru Montée de Tonnerre',
        producer:   'William Fèvre',
        vintage:    2021,
        type:       'white',
        region:     'Chablis, Burgundy',
        grapes:     ['Chardonnay'],
        priceRange: '€30–40',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'oyster', 'seafood', 'shellfish', 'fish', 'crab', 'shrimp', 'sushi', 'chicken', 'cream',
          // NL
          'oester', 'zeevruchten', 'schelpdieren', 'vis', 'krab', 'garnaal', 'garnalen', 'sushi',
          'kip', 'room', 'kabeljauw', 'schelvis', 'tong', 'zeetong', 'mosselen', 'kreeft'
        ]
      },
      {
        name:       'Châteauneuf-du-Pape',
        producer:   'Château Rayas',
        vintage:    2019,
        type:       'red',
        region:     'Rhône Valley',
        grapes:     ['Grenache', 'Mourvèdre', 'Syrah'],
        priceRange: '€45–65',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'lamb', 'beef', 'pork', 'rabbit', 'game', 'duck', 'sausage', 'stew', 'herbs', 'garlic', 'olive',
          // NL
          'lam', 'rund', 'rundvlees', 'varken', 'konijn', 'wild', 'eend', 'worst', 'stoofvlees',
          'gestoofd', 'kruiden', 'knoflook', 'olijf', 'biefstuk', 'lamsbout',
          // FR
          'agneau', 'boeuf', 'bourguignon', 'daube', 'lapin', 'canard', 'gibier', 'saucisse', 'herbes',
          'provence', 'cassoulet', 'confit',
          // IT
          'agnello', 'manzo', 'coniglio', 'anatra', 'selvaggina', 'brasato', 'salsiccia'
        ]
      },
      {
        name:       'Grüner Veltliner Smaragd',
        producer:   'F.X. Pichler',
        vintage:    2021,
        type:       'white',
        region:     'Wachau, Austria',
        grapes:     ['Grüner Veltliner'],
        priceRange: '€35–50',
        url:        'https://www.okhuysen.nl',
        pairings:   [
          // EN
          'schnitzel', 'pork', 'veal', 'chicken', 'salad', 'vegetables', 'white asparagus', 'fish', 'sushi', 'spicy',
          // NL
          'schnitzel', 'varken', 'varkensvlees', 'kalf', 'kalfsvlees', 'kip', 'salade', 'groenten',
          'witte asperges', 'asperges', 'vis', 'sushi', 'pittig', 'kruiden'
        ]
      }
    ]
  }

  /* ── Add next importer here ────────────────────────────────────────────── */
  // {
  //   id:      'second-importer',
  //   name:    'Name',
  //   tagline: { nl: 'Aanbevolen door Name', en: 'Recommended by Name' },
  //   color:   '#2B5E3F',
  //   website: 'https://www.example.com',
  //   active:  false,
  //   wines:   [...]
  // }

];
