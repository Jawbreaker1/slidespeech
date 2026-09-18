# Dependency Corrections

## PptxGenJS 3.12.0: One Actual Slide Master

R17 is a package serialization defect, not generated-content recovery.
`makeXmlContTypes` declares one slide master per slide, while `exportPresentation`
writes only `ppt/slideMasters/slideMaster1.xml`. This produces dangling content-type
declarations in every multi-slide export.

The checked-in correction declares that actual shared master once, outside the
slide loop, in the package's CommonJS and ES module entrypoints. It changes no
slide content, layout, relationship, or completed ZIP file. It adds no runtime
repair stage. The unmodified UMD bundles are not application entrypoints.

The provider dependency is pinned to `3.12.0`. Root `postinstall` applies the
versioned patch using `patch-package --error-on-fail`; installations must not skip
scripts. `patch-package` is a production dependency so `--omit=dev` retains it.
The package-integrity regression is mandatory, not TODO. Independent artifact
validation checks the exported ZIP as well.

Remove this correction only when a tested upstream release writes a valid package
without it. Version 4.0.1 still has the same source defect, so upgrading alone is
not a verified fix. Do not use dependency patches for semantic generation changes
or to rewrite exports until validators accept them.

Upstream source: https://github.com/gitbrent/PptxGenJS/blob/v4.0.1/src/gen-xml.ts
Patch tooling: https://github.com/ds300/patch-package
