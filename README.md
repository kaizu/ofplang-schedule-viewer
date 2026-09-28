# cdn

Built viewers for thin pages, one commit per release of ofplang/export. Nothing
here is edited by hand: the release workflow (`.github/workflows/publish.yml`
on main) builds `ofp-view.js` from the tagged commit, commits it here and tags
the commit `cdn-v<version>`, which jsdelivr serves as

    https://cdn.jsdelivr.net/gh/ofplang/export@cdn-v<version>/ofp-view.js
