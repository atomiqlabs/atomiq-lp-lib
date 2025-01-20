"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routesMatch = void 0;
function routesMatch(routesA, routesB) {
    if (routesA === routesB)
        return true;
    if (routesA == null || routesB == null) {
        return false;
    }
    if (routesA.length !== routesB.length)
        return false;
    for (let i = 0; i < routesA.length; i++) {
        if (routesA[i] === routesB[i])
            continue;
        if (routesA[i] == null || routesB[i] == null) {
            return false;
        }
        if (routesA[i].length !== routesB[i].length)
            return false;
        for (let e = 0; e < routesA[i].length; e++) {
            if (routesA[i][e] === routesB[i][e])
                continue;
            if (routesA[i][e] == null || routesB[i][e] == null) {
                return false;
            }
            if (routesA[i][e].publicKey !== routesB[i][e].publicKey ||
                !routesA[i][e].baseFeeMtokens.eq(routesB[i][e].baseFeeMtokens) ||
                routesA[i][e].channel !== routesB[i][e].channel ||
                routesA[i][e].cltvDelta !== routesB[i][e].cltvDelta ||
                routesA[i][e].feeRate !== routesB[i][e].feeRate) {
                return false;
            }
        }
    }
    return true;
}
exports.routesMatch = routesMatch;
