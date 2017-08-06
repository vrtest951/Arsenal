'use strict'; // eslint-disable-line strict

const assert = require('assert');
const http = require('http');
const https = require('https');
const querystring = require('querystring');

class LivyClient {
    /**
     * Constructor for REST client to apache livy
     *
     * @param {string} host - hostname or IP of the livy server
     * @param {number} [port=8998] - port of the livy server
     * @param {object} [logger=console] - logger object
     * @param {boolean} [useHttps] - whether to use https or not
     * @param {string} [key] - https private key content
     * @param {string} [cert] - https public certificate content
     * @param {string} [ca] - https authority certificate content
     * @return {undefined}
     */
    constructor(host, port = 8998, logger = console, useHttps, key, cert, ca) {
        assert(typeof host === 'string' && host !== '', 'host is required');
        assert(typeof port === 'number', 'port must be a number');
        assert(typeof logger === 'object', 'logger must be an object');
        assert(typeof logger.error === 'function', 'logger must have' +
        'error method');
        assert(typeof logger.info === 'function', 'logger must have' +
        'info method');
        assert(key === undefined || typeof key === 'string',
                'key must be a string');
        assert(cert === undefined || typeof cert === 'string',
                'cert must be a string');
        assert(ca === undefined || typeof ca === 'string',
                'ca must be a string');
        this.serverHost = host;
        this.serverPort = port;
        this.logger = logger;
        this._key = key;
        this._cert = cert;
        this._ca = ca;
        this.useHttps = (useHttps === true);
        if (this.useHttps) {
            this.transport = https;
            this._agent = new https.Agent({
                ca: ca ? [ca] : undefined,
                keepAlive: true,
                requestCert: true,
            });
        } else {
            this.transport = http;
            this._agent = new http.Agent({
                keepAlive: true,
            });
        }
        return undefined;
    }

    /** Returns interactive sessions
     * @param {number} [startIndex] - index to start listing
     * @param {number} [numOfSessions] - number of sessions to
     * return
     * @param {function} callback - callback
     * @return {undefined}
     */
    getSessions(startIndex, numOfSessions, callback) {
        assert(typeof callback === 'function', 'callback must be a function');
        const params = {};
        if (startIndex) {
            assert(Number.isInteger(startIndex),
            'startIndex must be an integer');
            params.from = startIndex;
        }
        if (numOfSessions) {
            assert(Number.isInteger(numOfSessions),
            'numOfSessions must be an integer');
            params.size = numOfSessions;
        }
        this._request('GET', '/sessions',
            params, null, callback);
        return undefined;
    }

    /** Creates a new interactive Scala, Python, or R shell in the cluster
     * @param {object} options - options for session
     * @param {string} options.kind - type of session: spark, pyspark,
     * pyspark3 or sparkr. If not specified, defaults to spark.
     * For other options, see: https://github.com/apache/
     * incubator-livy/blob/master/docs/rest-api.md#post-sessions
     * @param {function} callback - callback
     * @return {undefined}
     */
    postSession(options, callback) {
        assert(typeof callback === 'function', 'callback must be a function');
        assert(typeof options === 'object', 'options must ben an object');
        let postBody = options;
        if (!options.kind) {
            postBody.kind = 'spark';
        }
        postBody = JSON.stringify(postBody);
        this._request('POST', '/sessions',
            null, postBody, callback);
        return undefined;
    }

    /** Deletes a session
     * @param {number} sessionId - sessionId to delete
     * @param {function} callback - callback
     * @return {undefined}
     */
    deleteSession(sessionId, callback) {
        assert(typeof callback === 'function', 'callback must be a function');
        assert(Number.isInteger(sessionId), 'sessionId must be an integer');
        this._request('DELETE', `/sessions/${sessionId}`,
            null, null, callback);
        return undefined;
    }

    _endResponse(res, data, callback) {
        const code = res.statusCode;
        if (code <= 201) {
            this.logger.info(`request to ${this.serverHost} returned success`,
                { httpCode: code });
            return callback(null, data);
        }
        const error = new Error(res.statusMessage);
        this.logger.info(`request to ${this.serverHost} returned error`,
            { statusCode: code, statusMessage: res.statusMessage,
                info: data });
        return callback(error, data);
    }

    /**
     * @param {string} method - the HTTP method of the request
     * @param {string} path - path without query parameters
     * @param {object} params - query parameters of the request
     * @param {string} dataToSend - data of the request
     * @param {function} callback - callback
     * @return {undefined}
     */
    _request(method, path, params, dataToSend, callback) {
        assert(method === 'GET' || method === 'POST' || method === 'DELETE',
        'httpMethod must be GET, POST or DELETE');
        assert(typeof callback === 'function', 'callback must be a function');
        assert(typeof path === 'string', 'path must be a string');
        assert(typeof params === 'object', 'pararms must be an object');
        this.logger.info('sending request',
        { httpMethod: method, path, params });
        let fullPath = path;
        const headers = {
            'content-length': 0,
        };

        if (params) {
            fullPath += `?${querystring.stringify(params)}`;
        }

        const options = {
            method,
            path: fullPath,
            headers,
            hostname: this.serverHost,
            port: this.serverPort,
            agent: this.agent,
        };
        if (this._cert && this._key) {
            options.key = this._key;
            options.cert = this._cert;
        }
        const dataResponse = [];
        let dataResponseLength = 0;

        const req = this.transport.request(options);
        req.setNoDelay();

        if (dataToSend) {
            /*
            * Encoding data to binary provides a hot path to write data
            * directly to the socket, without node.js trying to encode the data
            * over and over again.
            */
            const binData = Buffer.from(dataToSend, 'utf8');
            req.setHeader('content-type', 'application/octet-stream');
            /*
            * Using Buffer.bytelength is not required here because data is
            * binary encoded, data.length would give us the exact byte length
            */
            req.setHeader('content-length', binData.length);
            req.write(binData);
        }

        req.on('response', res => {
            res.on('data', data => {
                dataResponse.push(data);
                dataResponseLength += data.length;
            }).on('error', callback).on('end', () => {
                this._endResponse(res, Buffer.concat(dataResponse,
                    dataResponseLength).toString(), callback);
            });
        }).on('error', error => {
            // covers system errors like ECONNREFUSED, ECONNRESET etc.
            this.logger.error('error sending request to livy', { error });
            return callback(error);
        }).end();
    }

}

module.exports = LivyClient;