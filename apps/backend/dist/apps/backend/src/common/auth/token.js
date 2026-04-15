"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAuthToken = exports.createAuthToken = void 0;
const api_core_1 = require("@waseller/api-core");
/** Compatibilidad Nest: usa `process.env` para el secreto y TTL. */
const createAuthToken = (payload) => (0, api_core_1.createAuthToken)((0, api_core_1.authTokenEnvFromProcess)(process.env), payload);
exports.createAuthToken = createAuthToken;
const verifyAuthToken = (token) => (0, api_core_1.verifyAuthToken)((0, api_core_1.authTokenEnvFromProcess)(process.env), token);
exports.verifyAuthToken = verifyAuthToken;
