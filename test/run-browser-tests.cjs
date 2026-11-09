/*
 * Headless-Chrome runner for the QUnit browser suite (test/index.html).
 * Upstream only ran this suite through TestSwarm; this script lets CI run it
 * against a local PHP server and prints per-test results plus a summary.
 *
 * Usage: node test/run-browser-tests.cjs <url> [chromePath]
 * Requires puppeteer-core on NODE_PATH and a modern Node (>= 18).
 */
"use strict";

var puppeteer = require( "puppeteer-core" );

var url = process.argv[ 2 ] || "http://127.0.0.1:8000/test/index.html",
	chromePath = process.argv[ 3 ] || process.env.CHROME_BIN || "/usr/bin/google-chrome-stable",
	TIMEOUT_MS = 40 * 60 * 1000;

function hookQUnit() {
	if ( window.top !== window ) {
		return;
	}
	window.__qunitResults = { tests: [], assertions: {}, done: null };
	document.addEventListener( "DOMContentLoaded", function() {
		var Q = window.QUnit;
		if ( !Q ) {
			window.__qunitResults.done = { error: "QUnit not found on page" };
			return;
		}
		Q.log(function( d ) {
			if ( !d.result ) {
				var key = d.module + " :: " + d.name;
				( window.__qunitResults.assertions[ key ] =
					window.__qunitResults.assertions[ key ] || [] ).push({
					message: String( d.message ),
					actual: String( d.actual ),
					expected: String( d.expected ),
					source: d.source ? String( d.source ).split( "\n" )[ 0 ] : ""
				});
			}
		});
		Q.testDone(function( d ) {
			window.__qunitResults.tests.push({
				module: d.module, name: d.name,
				failed: d.failed, passed: d.passed, total: d.total
			});
		});
		Q.done(function( d ) {
			window.__qunitResults.done = {
				failed: d.failed, passed: d.passed, total: d.total, runtime: d.runtime
			};
		});
	});
}

( async function() {
	var browser = await puppeteer.launch({
		executablePath: chromePath,
		headless: true,
		args: [ "--no-sandbox", "--disable-gpu", "--window-size=1280,1024" ]
	});
	var page = await browser.newPage();
	var printed = 0, start = Date.now(), skipped = [], res, i, t, failures, key;

	await page.setViewport({ width: 1280, height: 1024 });
	await page.evaluateOnNewDocument( hookQUnit );
	page.on( "console", function( msg ) {
		var text = msg.text();
		if ( /^SKIPPED: /.test( text ) ) {
			skipped.push( text.slice( 9 ) );
			console.log( text );
		}
	});
	page.on( "pageerror", function( e ) {
		console.log( "[page error] " + e.message );
	});

	console.log( "Browser: " + await browser.version() );
	console.log( "Opening " + url );
	await page.goto( url, { waitUntil: "load", timeout: 120000 } );

	for ( ;; ) {
		await new Promise(function( r ) { setTimeout( r, 2000 ); });
		res = await page.evaluate(function() { return window.__qunitResults; });
		for ( ; res && printed < res.tests.length; printed++ ) {
			t = res.tests[ printed ];
			console.log( ( t.failed ? "FAIL" : "PASS" ) + " " + t.module + " :: " + t.name +
				" (" + t.passed + "/" + t.total + " assertions)" );
			if ( t.failed ) {
				failures = res.assertions[ t.module + " :: " + t.name ] || [];
				failures.forEach(function( f ) {
					console.log( "    - " + f.message + "\n      expected: " + f.expected +
						"\n      actual:   " + f.actual + ( f.source ? "\n      at " + f.source : "" ) );
				});
			}
		}
		if ( res && res.done ) {
			break;
		}
		if ( Date.now() - start > TIMEOUT_MS ) {
			console.log( "Timed out waiting for the QUnit suite to finish" );
			await browser.close();
			process.exit( 2 );
		}
	}

	await browser.close();

	if ( res.done.error ) {
		console.log( res.done.error );
		process.exit( 2 );
	}

	failures = res.tests.filter(function( t ) { return t.failed; });
	console.log( "\n==== QUnit summary ====" );
	console.log( "Tests run: " + res.tests.length + ", passed: " +
		( res.tests.length - failures.length ) + ", failed: " + failures.length +
		", skipped (excluded in source): " + skipped.length );
	console.log( "Assertions: " + res.done.total + " total, " + res.done.passed +
		" passed, " + res.done.failed + " failed (" + res.done.runtime + " ms)" );
	for ( i = 0; i < skipped.length; i++ ) {
		console.log( "SKIPPED: " + skipped[ i ] );
	}
	for ( i = 0; i < failures.length; i++ ) {
		key = failures[ i ];
		console.log( "FAILED: " + key.module + " :: " + key.name );
	}
	process.exit( failures.length || res.done.failed ? 1 : 0 );
})().catch(function( e ) {
	console.error( e );
	process.exit( 2 );
});
