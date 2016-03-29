#!/bin/sh

if [ ! -d "node_modules/.bin" ]; then
  echo "Be sure to run \`npm install\` before building meldio-client-js."
  exit 1;
fi

rm -rf dist/ && mkdir -p dist/ &&
babel src --optional runtime --ignore __tests__ --out-dir dist/ &&
browserify -g browserify-shim -s Meldio dist/index.js > meldio.js &&
browserify -g browserify-shim -g uglifyify -s Meldio dist/index.js | uglifyjs -c --screw-ie8 > meldio.min.js
