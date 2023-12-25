'use strict';

const fs = require('fs');
const net = require('net');
const http = require('http');
const HttpDispatcher = require('httpdispatcher');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const socket = new net.Socket();
const dispatcher = new HttpDispatcher();

let clientState = 0;
let mpdVersion = '';
let mpdStatus = {};
let mpdSong = {};
let response = null;

function leadingZero(num) {
	if (num > 9) {
		return num;
	}

	return '0' + num;
}

function logger(line) {
	const dt = new Date;
	const args = [line];

	args.unshift(
		'[' +
		leadingZero(dt.getDate()) + '.' +
		leadingZero(dt.getMonth()) + '.' +
		dt.getFullYear() + ' ' +
		leadingZero(dt.getHours()) + ':' +
		leadingZero(dt.getMinutes()) + ':' +
		leadingZero(dt.getSeconds()) +
		']'
	);

	console.log.apply(console, args);
}

function parseResponse(lines) {
	let parsed = {};

	for (let i = 0; i < lines.length; ++i) {
		const line = lines[i];

		if (line === 'OK') {
			break;
		}

		const matches = line.match(/^([a-z_-]+): (.*)$/i);

		if (!matches) {
			continue;
		}

		parsed[matches[1]] = matches[2];
	}

	return parsed;
}

socket.on('close', function() {
	clientState = 0;
	logger('Connection to mpd closed');
});

socket.on('error', function(err) {
	sendResponse({
		error: err.message
	});
});

socket.on('data', function(data) {
	const lines = data.toString().split('\n');

	switch (clientState) {
		case 0:
			const matches = lines[0].match(/^OK MPD ([0-9.]+)$/);

			if (matches) {
				clientState = 1;
				mpdVersion = matches[1];
				logger('mpd ' + mpdVersion + ' responded');
				logger('Requesting status...');
				socket.write('status\n');
			}
			else {
				socket.destroy();
			}

			break;
		case 1:
			logger('Received status');
			clientState = 2;
			mpdStatus = parseResponse(lines);
			logger('Requesting current song...');
			socket.write('currentsong\n');
			break;
		case 2:
			logger('Received current song');
			clientState = 3;
			mpdSong = parseResponse(lines);
			logger('Saying goodbye...');
			socket.write('close\n');
			sendResponse({
				status: mpdStatus,
				currentSong: mpdSong
			});
			break;
	}
});

function getSong() {
	logger('Connecting to mpd...');

	socket.connect(config.mpd.port, config.mpd.host, function() {
		logger('Connected to mpd');
	});
}

function sendResponse(data) {
	if (response === null) {
		return;
	}

	response.writeHead(200, {
		'Content-Type': 'application/json'
	});

	response.end(JSON.stringify(data));

	response = null;
}

dispatcher.onGet('/status', function(req, res) {
	response = res;
	getSong();
});

http.createServer(function(req, res) {
	const conn = req.connection;

	logger('HTTP client connected: ' + conn.remoteAddress + ':' + conn.remotePort);
	logger(req.method + ' ' + req.url);

	try {
		dispatcher.dispatch(req, res);
	}
	catch(err) {
		logger(err);
	}
}).listen(config.listen, function() {
	logger('Server listening on port ' + config.listen.port);
});
