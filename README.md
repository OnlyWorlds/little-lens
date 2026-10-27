# Little Lens

Look at an [OnlyWorlds](https://www.onlyworlds.com) world through a lens: the whole world as a web of its elements and links, and each element with what it links to and what links to it.

Little Lens only reads. It never changes a world: to edit one, open it in [Atlas](https://atlas.onlyworlds.com) or [Lantern](https://lantern.onlyworlds.com).

## Ways in

- **A public world, without an account.** A world whose owner has opened it to the public is read from OnlyWorlds with no key and no sign-in. Moppetopia, a small demo world, is one click from the first screen. Any public world opens at `#/w/<world id>`.
- **A world file or folder.** A `.owworld` file, or a world folder as Atlas keeps one on disk. It is read in your browser and held only while the page is open: nothing from it is sent anywhere or stored.
- **Sign in with OnlyWorlds**, for the worlds you own or have joined. It is offered only on little-lens.onlyworlds.com, the address OnlyWorlds sends you back to. Little Lens holds one sign-in in the page's memory and never stores it, so a reload asks you to sign in again. It removes the sign-in from your account when you sign out, and tries to when you leave the page. A sign-in left behind (a closed browser, a killed tab) ends by itself six hours after you signed in; until then it is listed under Account settings on onlyworlds.com, where you can remove it. It never makes keys on your account. Your worlds open at `#/me/<world id>`, read as your account reads them, through the same graph rules as any other world.

## What it shows

- **The world web**: every element once, coloured by its type, laid out so the same world always lands the same way. Dot size follows links, and the most linked are named. Filter by type or search by name and description; switch to a list of cards.
- **Time**: the world's dated elements on a strip, each at its own date (a Character's birth date, a Location's founding date, an Event's start date, and so on, by the OnlyWorlds lens profile's date table), named in the world's calendar when it has exactly one, with the world's now as a line. Drag along the strip or use the arrow keys to choose a moment; the address keeps it (`/time?at=<step>`), and the list below marks what comes after it. Elements of a dated type with no date are counted, never placed.
- **An element**: its fields in the schema's sections, links as chips you can follow, and its neighbourhood as a small radial graph (solid lines for what it links to, dashed for what links to it).

What the graph draws follows the OnlyWorlds graph rules: the schema's link fields are the edges, a Relation is an element like any other, and map space (maps, pins, markers, zones) is left out. Elements marked hidden or proposed, and the elements of a room, are left out too, and the page says how many.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the unit tests
npm run build    # dist/, served as static files
```

It uses [`@onlyworlds/sdk`](https://www.npmjs.com/package/@onlyworlds/sdk) for the schema, the world file reader and the marks, and [`d3-force`](https://github.com/d3/d3-force) for the layout.

## License

MIT
