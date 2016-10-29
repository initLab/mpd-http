'use strict';

let fs = require('fs');
let net = require('net');
let http = require('http');
let dispatcher = require('httpdispatcher');

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

let socket = new net.Socket();
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
	var dt = new Date;
	var args = [line];
	args.unshift(
		'[' +
		leadingZero(dt.getDate()) + '.' +
		leadingZero(dt.getMonth()) + '.' +
		(1900 + dt.getYear()) + ' ' +
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
		let line = lines[i];

		if (line === 'OK') {
			break;
		}

		let matches = line.match(/^([a-z]+): (.*)$/i);
		
		if (!matches) {
			return;
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
	let lines = data.toString().split('\n');
	
	switch (clientState) {
		case 0:
			let matches = lines[0].match(/^OK MPD ([0-9.]+)$/);

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
	let conn = req.connection;
	
	logger('HTTP client connected: ' + conn.remoteAddress + ':' + conn.remotePort);
	logger(req.method + ' ' + req.url);
	
	try {
		dispatcher.dispatch(req, res);
	}
	catch(err) {
		logger(err);
	}
}).listen(config.listen.port, function() {
	logger('Server listening on: http://0.0.0.0:' + config.listen.port);
});
