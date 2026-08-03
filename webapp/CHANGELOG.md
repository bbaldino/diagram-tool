# Changelog

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
