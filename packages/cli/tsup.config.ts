import { defineConfig } from "tsup";



export default defineConfig({

  entry: ["src/cli.ts"],

  format: ["esm"],

  target: "node22",

  platform: "node",

  clean: true,

  sourcemap: true,

  bundle: true,

  splitting: false,

  dts: false,

  external: [/^@ledgeindex\//, /^@mastra\//],

  banner: {

    js: "#!/usr/bin/env node",

  },

});

