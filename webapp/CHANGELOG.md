# Changelog

## [0.9.0](https://github.com/bbaldino/diagram-tool/compare/v0.8.2...v0.9.0) (2026-08-20)


### Features

* **canvas:** active-diagram routing store ([b0ed842](https://github.com/bbaldino/diagram-tool/commit/b0ed8422d9dc1f3ec76808479b26fd66243d6d30))
* **canvas:** DiagramSettingsDialog (router + pathfinding knobs) ([63d376e](https://github.com/bbaldino/diagram-tool/commit/63d376ee1c6e1617870a3f5b50f4946d3663c518))
* **canvas:** edge-aware routing coordinator (sequential + avoidAreas) ([39fdc97](https://github.com/bbaldino/diagram-tool/commit/39fdc97d043eab6844a5b2e46154cd3f3bb201e4))
* **canvas:** ELK controls + Apply & Tidy in settings dialog ([e63e4ca](https://github.com/bbaldino/diagram-tool/commit/e63e4ca0bb66571b13bf5b9ea676d803369fdc00))
* **canvas:** ElkControls knob component ([b189db1](https://github.com/bbaldino/diagram-tool/commit/b189db10e2199d0f5472009a12f75de78b85f522))
* **canvas:** ephemeral edge-route store ([760511c](https://github.com/bbaldino/diagram-tool/commit/760511c7af9761a1ec574cc3dac3a099355ae61d))
* **canvas:** ephemeral label-placement store ([6df974d](https://github.com/bbaldino/diagram-tool/commit/6df974d9d47bdda863f1e3bdc2736b81d1aa0532))
* **canvas:** extract PathfindingControls knob component ([7e4529d](https://github.com/bbaldino/diagram-tool/commit/7e4529da69edd3e02e4391ad745a4c2bce822c8c))
* **canvas:** label de-collision coordinator hook ([803ffe5](https://github.com/bbaldino/diagram-tool/commit/803ffe5d447b2824cc59b8d6fd0aaba88d3783cc))
* **canvas:** live tuning panel for pathfinding-edge knobs ([ef44939](https://github.com/bbaldino/diagram-tool/commit/ef449397b93f504242a646a55b602aa194c0fd3b))
* **canvas:** patchElk on routing store ([e34d203](https://github.com/bbaldino/diagram-tool/commit/e34d203cc015cbcf60f31be8e7efa5cc56fa8491))
* **canvas:** pathfinding (smart) edge demo ([3b72814](https://github.com/bbaldino/diagram-tool/commit/3b728144c1f9ce1b83a5b404e393cb2e82407b7a))
* **canvas:** per-diagram routing settings dialog + menu wiring ([bb30246](https://github.com/bbaldino/diagram-tool/commit/bb30246c93b4f0627b641fe3e884bd7ff8a8e69c))
* **canvas:** pick edge type from diagram router ([5edae72](https://github.com/bbaldino/diagram-tool/commit/5edae722004056380af29477e13aff1c1bc4e92a))
* **canvas:** pure label de-collision resolver ([8b94c10](https://github.com/bbaldino/diagram-tool/commit/8b94c100c320b6da40a6d2e3b537d313f8e0a732))
* **canvas:** run edge-aware routing on pathfinding diagrams ([4d4f2f2](https://github.com/bbaldino/diagram-tool/commit/4d4f2f2d49dca4249734259daba4684483704671))
* **canvas:** run label de-collision on pathfinding diagrams ([b6cb586](https://github.com/bbaldino/diagram-tool/commit/b6cb586f0bf32f0d775b91e94262dff8a3efba64))
* **canvas:** seed edge labels from their solo stretch ([8ef6f9d](https://github.com/bbaldino/diagram-tool/commit/8ef6f9d7521250599c7cefb11af3520885b117a2))
* **canvas:** smart edge renders coordinator route when present ([f84507d](https://github.com/bbaldino/diagram-tool/commit/f84507d58dead0ca1aac92ab3eab9c244bc3ac6a))
* **canvas:** smart-edge label + start marker parity ([5d3637a](https://github.com/bbaldino/diagram-tool/commit/5d3637a308342722012064d163c8bfa92c091936))
* **canvas:** smart-edge label placement (auto + drag-to-pin) ([db41bc2](https://github.com/bbaldino/diagram-tool/commit/db41bc27e9eaf368e47c93a958bdc27e48bbbad7))
* **canvas:** soloLabelPos — label anchor on an edge's solo stretch ([526a5e9](https://github.com/bbaldino/diagram-tool/commit/526a5e96b529ccaecfc93e4217d04f8bafe2c222))
* **canvas:** wire Apply & Tidy onTidy to layout ([371ce4c](https://github.com/bbaldino/diagram-tool/commit/371ce4c2d0e9e92af5421a6884536f0c2f773d08))
* **layout:** drive ELK options from per-diagram ElkConfig ([a286bce](https://github.com/bbaldino/diagram-tool/commit/a286bcee16ba2fbc38ac8adb4b899f2006d88275))
* **layout:** hierarchical ELK edge routing with geometry-first handles ([a2df790](https://github.com/bbaldino/diagram-tool/commit/a2df790e0b6af9da1ea247362980ad5fb42c8154))
* **model:** DiagramRouting type, DEFAULT_ROUTING, and helpers ([427a78c](https://github.com/bbaldino/diagram-tool/commit/427a78cd074a0a8eeb22d5aad699dad307ea533a))
* **model:** edge separation knob (default 0) ([4fecbb7](https://github.com/bbaldino/diagram-tool/commit/4fecbb7b8995a4192d3166f454c8d2d653ff763c))
* **model:** ElkConfig + DEFAULT_ELK on DiagramRouting ([24294c5](https://github.com/bbaldino/diagram-tool/commit/24294c50f034d91c59b359143bbb5506c06e20b9))
* **model:** persist edge labelOffset + labelPinned ([56115d1](https://github.com/bbaldino/diagram-tool/commit/56115d1be10860d7a5230d1bdcdf9cbecefeab29))
* **ops:** diagram.setRouting op ([a3eb133](https://github.com/bbaldino/diagram-tool/commit/a3eb1333bc8818d2ee0ec5814e3464b08e557ade))


### Bug Fixes

* **canvas:** decouple router switch from model re-seed ([27212f2](https://github.com/bbaldino/diagram-tool/commit/27212f2fe00e6f060bb082a942c4f3510f37c611))
* **canvas:** route edge-aware endpoints from live node handles, not stale path ([df8e9e5](https://github.com/bbaldino/diagram-tool/commit/df8e9e5d8abf7b564aaf4274226f66ea78027bc9))
* **layout:** carry grouped notes and satellites through hierarchical topology layout ([f99babe](https://github.com/bbaldino/diagram-tool/commit/f99babe0515269d7a603f1326c7ff3c5094b6967))

## [0.8.2](https://github.com/bbaldino/diagram-tool/compare/v0.8.1...v0.8.2) (2026-08-05)


### Bug Fixes

* **canvas:** drop the leftover +Group / +Note toolbar ([064d87f](https://github.com/bbaldino/diagram-tool/commit/064d87fff8a8a7e68d26801b7dda63500cc7f681))

## [0.8.1](https://github.com/bbaldino/diagram-tool/compare/v0.8.0...v0.8.1) (2026-08-05)


### Bug Fixes

* **canvas:** give group panes room to nest below the edge layer ([6824699](https://github.com/bbaldino/diagram-tool/commit/6824699365eed544036b92ccc809a025bd395452))
* **canvas:** stop disabling every edge while a group is selected ([8527389](https://github.com/bbaldino/diagram-tool/commit/8527389317015c6509180e9045d9e512b9a2a784))

## [0.8.0](https://github.com/bbaldino/diagram-tool/compare/v0.7.0...v0.8.0) (2026-08-05)


### Features

* **edges:** back-fill an explicit colour on every edge ([792b7b1](https://github.com/bbaldino/diagram-tool/commit/792b7b10a566b62ec0ed034bff38a938718109ce))


### Bug Fixes

* **canvas:** continuous selection ring, and a corner grab worth aiming at ([c834ad8](https://github.com/bbaldino/diagram-tool/commit/c834ad8ff513383a820bdd39938efda7be43a3b4))
* **canvas:** keep connection points clickable above the resize controls ([410cb6d](https://github.com/bbaldino/diagram-tool/commit/410cb6dd60c0341d03b45b6508a6350ca6efa861))
* **edges:** set the starting colour instead of clearing it ([4bf90b8](https://github.com/bbaldino/diagram-tool/commit/4bf90b84294fd285ab3a0c629cb67d752bc2a566))
* **server:** fail to boot on an unreadable model instead of seeding empty ([4cb1f59](https://github.com/bbaldino/diagram-tool/commit/4cb1f59d2f83f3f968c4d5598e8a696a981efaca))

## [0.7.0](https://github.com/bbaldino/diagram-tool/compare/v0.6.0...v0.7.0) (2026-08-04)


### Features

* **schemes:** add the named colour scheme table and resolver ([312eb31](https://github.com/bbaldino/diagram-tool/commit/312eb31c2417f1f4f394e2e8758d92be1ae48799))
* **schemes:** pick schemes by name in the inspector and over MCP ([4e1203a](https://github.com/bbaldino/diagram-tool/commit/4e1203ab52a7ccf34c84059adde950e73b37acf7))
* **schemes:** rename color -&gt; scheme on nodes and notes, back-fill on load ([f6bc90c](https://github.com/bbaldino/diagram-tool/commit/f6bc90c189fe75776d45b3715c25a017d8b619cd))
* **schemes:** render nodes and notes from a resolved scheme ([14177fa](https://github.com/bbaldino/diagram-tool/commit/14177fa6997422c7fbe4b0344ce64a8c4772f051))


### Bug Fixes

* derive secondary text with a contrast clamp ([bd7f2cc](https://github.com/bbaldino/diagram-tool/commit/bd7f2ccf8f7fbb21cc4a5072700c802b99eca34f))
* **schemes:** keep the edge and group reset, which is not a scheme default ([da3360c](https://github.com/bbaldino/diagram-tool/commit/da3360ca23b645ba56bf773015b22fa5b5def198))
* **schemes:** make backfillSchemes total so a bad diagram cannot wipe the model ([1cfcb20](https://github.com/bbaldino/diagram-tool/commit/1cfcb20cf8e073ad97004dd6ddfb052921a836fc))
* **schemes:** make palette swatches legible and darken note text ([0749743](https://github.com/bbaldino/diagram-tool/commit/074974329cd18da6e0aea1719cc8978ea63e8ebf))
* **schemes:** resolve own keys only, and export the name/hex seam ([ae5b004](https://github.com/bbaldino/diagram-tool/commit/ae5b004ee1dc40b37ceb2e5cd418f5598b07bb3c))
* **schemes:** separate scheme and colour quick-picks, reject the removed color field ([69a8a3a](https://github.com/bbaldino/diagram-tool/commit/69a8a3a0fdc8228e37f9ab925582d6e281afdd4b))

## [0.6.0](https://github.com/bbaldino/diagram-tool/compare/v0.5.0...v0.6.0) (2026-08-04)


### Features

* **color:** add a Default swatch to ColorPicker ([48c7126](https://github.com/bbaldino/diagram-tool/commit/48c71267da610a80d7104db2f76a270ae7e035d6))
* **color:** wire the Default swatch for every entity kind ([517567d](https://github.com/bbaldino/diagram-tool/commit/517567d14927961c14b4a6739a531760ead55373))


### Bug Fixes

* **colorpicker:** stop double-highlighting swatches at default state ([289e2a0](https://github.com/bbaldino/diagram-tool/commit/289e2a0469e4a111811306a031a1e33bb6212824))
* **edges:** restore edge Default swatch clearing colour override ([f86924c](https://github.com/bbaldino/diagram-tool/commit/f86924cc128e2070bec31549a57b84bc40e7049f))
* **model:** mergePatch deletes on undefined, not just null ([fb34ec6](https://github.com/bbaldino/diagram-tool/commit/fb34ec6245a7e0ab2764bf4db06f0c3de43077a1))
* **model:** route updateGroup/updateFlow through mergePatch ([c89f23f](https://github.com/bbaldino/diagram-tool/commit/c89f23f2edeabcb3a174a084809fa056c70c8418))
* **ops:** let a cleared optional field persist ([cc6b2a1](https://github.com/bbaldino/diagram-tool/commit/cc6b2a1b83f9f42b660f58711d229d623863ce35))

## [0.5.0](https://github.com/bbaldino/diagram-tool/compare/v0.4.0...v0.5.0) (2026-08-04)


### Features

* **color:** add yellow to the colour palette ([294587e](https://github.com/bbaldino/diagram-tool/commit/294587e2f14f19af2f21c98f35a574c6e3c47a35))
* **color:** tint the whole service node instead of an accent bar ([d951aa0](https://github.com/bbaldino/diagram-tool/commit/d951aa08582502b4491a4af986b19d707e4f7c4b))


### Bug Fixes

* **color:** correct the icon-placeholder contrast guard's compositing model ([991a0af](https://github.com/bbaldino/diagram-tool/commit/991a0af0909430247226ebf75ada604dda7bd800))
* **color:** stop the uncoloured-note picker from pre-selecting yellow ([10c1e43](https://github.com/bbaldino/diagram-tool/commit/10c1e431f528d2b7a923eca80b2dc9a77562421b))

## [0.4.0](https://github.com/bbaldino/diagram-tool/compare/v0.3.0...v0.4.0) (2026-08-03)


### Features

* **color:** accept an optional colour on the note and node MCP tools ([1b9a4dc](https://github.com/bbaldino/diagram-tool/commit/1b9a4dc8bff597ddd449453901cefcd4f8ff70f4))
* **color:** add optional color to Node and Note and plumb it through the canvas ([6ddc35b](https://github.com/bbaldino/diagram-tool/commit/6ddc35b9c1901aae42372bc4aa811d78ffacfc35))
* **color:** colour picker in the note, node and group inspectors ([ccb3774](https://github.com/bbaldino/diagram-tool/commit/ccb37746b05f5f893de4106eb468627e8c6728d4))
* **color:** render tinted notes and accented service nodes ([ee4e076](https://github.com/bbaldino/diagram-tool/commit/ee4e076f3ec52e0bad488b3f559962a6dc99d76e))


### Bug Fixes

* cover tinted note code/pre contrast and lower text mix to 55% ([bbfee9e](https://github.com/bbaldino/diagram-tool/commit/bbfee9e994c8ddf829293f0ce9ee36eeb4514414))
* darken tinted-note text mix so all palette colours pass WCAG AA ([36b50fa](https://github.com/bbaldino/diagram-tool/commit/36b50faa732b50089338ec07bb33944f8da69337))
* include note and node colours in diagram quick-picks ([5d9908a](https://github.com/bbaldino/diagram-tool/commit/5d9908ade68b0f6c647f38f749237adc9932582a))
* remove non-functional reset affordance from edge colour picker ([369f702](https://github.com/bbaldino/diagram-tool/commit/369f702d67a4e5107bafd1728dd1733abb1efed4))
* remove non-functional reset affordance from note/service colour pickers ([1d4a788](https://github.com/bbaldino/diagram-tool/commit/1d4a78871de82925fca8096ed5de784a9ff547f9))

## [0.3.0](https://github.com/bbaldino/diagram-tool/compare/v0.2.1...v0.3.0) (2026-08-03)


### Features

* **notes:** add markdown renderer for canvas notes ([7b5a379](https://github.com/bbaldino/diagram-tool/commit/7b5a379eef025e9908df72a8f2a46e16f2833f39))
* **notes:** render canvas notes as markdown when not selected ([412c18e](https://github.com/bbaldino/diagram-tool/commit/412c18eeb845598b1440c84acc85b2b1cf6016d6))


### Bug Fixes

* **mcp:** let connect join notes and groups, not just nodes ([1483824](https://github.com/bbaldino/diagram-tool/commit/14838248c4affec425b9e55dc76a8db6dfeed159))
* **notes:** focus textarea on select and unstick editing ref on deselect ([2182239](https://github.com/bbaldino/diagram-tool/commit/21822393a2be2891c1ce52e44c351a9303a9682d))
* **notes:** keep the caret in place when editing note text mid-string ([b1f9d79](https://github.com/bbaldino/diagram-tool/commit/b1f9d79ac85414373f2d83002b5ae398184e908e))
* **notes:** repair escaped newlines in note text written over MCP ([8da523b](https://github.com/bbaldino/diagram-tool/commit/8da523bc3636c465c6c50ecefabe98c8f20d8918))
* **notes:** skip markdown code contexts in escaped-newline repair ([9aa1495](https://github.com/bbaldino/diagram-tool/commit/9aa1495060d71198e297c6cfd1f342baf98df7d8))
* **notes:** stop link clicks from selecting the note into edit mode ([63def87](https://github.com/bbaldino/diagram-tool/commit/63def878ab68fc69464f841d0113e153b24eec62))
* **notes:** strip node prop before spreading onto markdown link anchor ([b620471](https://github.com/bbaldino/diagram-tool/commit/b6204710b5670ddd85dbc74e983aa7d10275f4ec))
* **notes:** treat unterminated fence as code to end-of-text per CommonMark ([b320e79](https://github.com/bbaldino/diagram-tool/commit/b320e796c848dc0fe4bf7ceb2a3fbd3cfc15197c))

## [0.2.1](https://github.com/bbaldino/diagram-tool/compare/v0.2.0...v0.2.1) (2026-08-03)


### Bug Fixes

* **layout:** keep annotations with their subject and use measured node heights ([0258c80](https://github.com/bbaldino/diagram-tool/commit/0258c80782c5d1872857447e78acb7e0fba10c90))

## [0.2.0](https://github.com/bbaldino/diagram-tool/compare/v0.1.0...v0.2.0) (2026-07-31)


### Features

* **view:** toggle spellcheck on note text via View menu ([ca9fe5f](https://github.com/bbaldino/diagram-tool/commit/ca9fe5f94a4beb31b9d519c44732aa24accb15e1))


### Bug Fixes

* **canvas:** persist note/group resize via liveFootprint in write-back ([e03d3b5](https://github.com/bbaldino/diagram-tool/commit/e03d3b57d0445a2e1017ed24225051ec84bff450))
* **canvas:** widen edge resize grab band on notes/groups ([e137563](https://github.com/bbaldino/diagram-tool/commit/e13756348d1162ba6d1076aa199c6970f151521c))
