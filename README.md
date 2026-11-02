# Little Lens

Look at an [OnlyWorlds](https://www.onlyworlds.com) world through a lens: the whole world as a web of its elements and links, and each element with what it links to and what links to it.

Little Lens only reads. It never changes a world: to edit one, open it in [Atlas](https://atlas.onlyworlds.com) or [Lantern](https://lantern.onlyworlds.com).

## Ways in

- **A public world, without an account.** A world whose owner has opened it to the public is read from OnlyWorlds with no key and no sign-in. Moppetopia, a small demo world, is one click from the first screen. Any public world opens at `#/w/<world id>`.
- **A world file or folder.** A `.owworld` file, or a world folder as Atlas keeps one on disk. It is read in your browser and held only while the page is open: nothing from it is sent anywhere or stored.
- **Sign in with OnlyWorlds**, for the worlds you own or have joined. It is offered only on little-lens.onlyworlds.com, the address OnlyWorlds sends you back to. Little Lens holds one sign-in in the page's memory and never stores it, so a reload asks you to sign in again. It removes the sign-in from your account when you sign out, and tries to when you leave the page. A sign-in left behind (a closed browser, a killed tab) ends by itself six hours after you signed in; until then it is listed under Account settings on onlyworlds.com, where you can remove it. It never makes keys on your account. Your worlds open at `#/me/<world id>`, read as your account reads them, through the same graph rules as any other world.
- **Small worlds from the OnlyWorlds standard.** The worlds the standard's lens and charter profiles are tested on, each opened as its owner sees it (`#/std`). They are bundled with Little Lens at one release of the standard (`src/standard/worlds.json`, written by `scripts/standard-worlds.mjs` and never by hand; `npm run check:standard` fails if it differs by a byte from what the script writes from that release, and runs on every push), so opening one reaches nothing but this page.
- **A link from another tool.** `#/open/<world id>`, or `#/open/<world id>/element/<element id>` for one element, is the address other tools and OnlyWorlds' Open with menus use. A world on your signed-in list opens as yours; any other is asked of OnlyWorlds without a key, and opens as a public world if it is one. If it is not, it opens as a signed-in address: signed out, that asks you to sign in and comes back to it. An element a public world does not show you offers the same sign-in, back to that element. The address is then replaced by the world's own, so Back never returns to it.

## What it shows

- **The world web**: every element once, coloured by its type, laid out so the same world always lands the same way. Dot size follows links, and the most linked are named. Filter by type or search by name and description; switch to a list of cards.
- **A lens**: the Lens box lists the world's lenses by name (Lens Constructs, made on the site's Lenses page), and choosing one redraws the web and the list through it: exactly the elements the lens keeps and the links between them, as the OnlyWorlds SDK reads the lens over the whole world, its time window counted from the world's now. An element's own page still shows all of its links. Maps, pins and markers stay off the web here even where a lens keeps them. The choice lasts while the world is open; a lens that keeps nothing here, or that the SDK cannot read, says so in place of the web.
- **Time**: the world's dated elements on a strip, each at its own date (a Character's birth date, a Location's founding date, an Event's start date, and so on, by the OnlyWorlds lens profile's date table), named in the world's calendar when it has exactly one, with the world's now as a line. Drag along the strip or use the arrow keys to choose a moment; the address keeps it (`/time?at=<step>`), and the list below marks what comes after it. Elements of a dated type with no date are counted, never placed.
- **An element**: its fields in the schema's sections, links as chips you can follow, and its neighbourhood as a small radial graph (solid lines for what it links to, dashed for what links to it).
- **A Character's draught at a moment**: what the record holds around one Character, dated up to a moment you choose on a strip of the draught's own dated rows, as OnlyWorlds serves it to you (signed out on a public world, or signed in). A second read of the whole draught lists what is dated after the moment, and the page says it was found that way. Copy as plain text gives the same text the OnlyWorlds SDK's `draughtText` writes. The address keeps the moment (`/e/<id>/draught?at=<step>`). It says what the record holds dated up to a moment, never what a Character knew then. A world file has no draught: it is read from OnlyWorlds.
- **Messages**: a world's messages (Narratives with the supertype Message) as conversations, newest first, and each conversation in order (`/messages/<id>`), read by the OnlyWorlds message profile through the SDK's readers. Each message says who it is from as far as that can be checked ("From Ada" only when the world proves it, "Claims to be from Ada" otherwise), whom it is to, and who has read it where read marks can be checked. A proposed message says so and is never shown as sent; a hidden one is counted and never shown. Read as the public, senders and read marks cannot be checked and a message may have recipients the public cannot see, and the page says so. A Note is not a message.

What the graph draws follows the OnlyWorlds graph rules: the schema's link fields are the edges, a Relation is an element like any other, a Zone is drawn, and map space (maps, pins and markers) is left out. A world's reading aids (its charter, guide and domains) are named first under "Read first" and kept off the whole world's web (a lens that keeps one draws it). Elements marked hidden or proposed, and the elements of a room, are left out too, and the page says how many.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the unit tests
npm run build    # dist/, served as static files
npm run check:standard   # the bundled small worlds against their release
```

It uses [`@onlyworlds/sdk`](https://www.npmjs.com/package/@onlyworlds/sdk) for the schema, the world file reader and the marks, and [`d3-force`](https://github.com/d3/d3-force) for the layout.

## License

MIT
