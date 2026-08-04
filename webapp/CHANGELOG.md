# Changelog

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
