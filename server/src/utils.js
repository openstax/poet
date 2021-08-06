"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.profileAsync = exports.profile = exports.getOrAdd = exports.fileExistsAtSync = exports.fileExistsAt = exports.expect = exports.calculateElementPositions = exports.generateDiagnostic = void 0;
var fs_1 = require("fs");
var SOURCE = 'cnxml';
function generateDiagnostic(severity, startPosition, endPosition, message, diagnosticCode) {
    var diagnostic = {
        severity: severity,
        range: {
            start: startPosition,
            end: endPosition
        },
        message: message,
        source: SOURCE,
        code: diagnosticCode
    };
    return diagnostic;
}
exports.generateDiagnostic = generateDiagnostic;
function calculateElementPositions(element) {
    // Calculate positions accounting for the zero-based convention used by
    // vscode
    var startPosition = {
        line: element.lineNumber - 1,
        character: element.columnNumber - 1
    };
    var elementSibling = element.nextSibling;
    var endPosition;
    // Establish the end position using as much information as possible
    // based upon (in order of preference) 1) element sibling 2) final element
    // attribute 3) the tag
    if (elementSibling != null) {
        endPosition = {
            line: element.nextSibling.lineNumber - 1,
            character: element.nextSibling.columnNumber - 1
        };
    }
    else if (element.attributes.length > 0) {
        var elementAttributes = element.attributes;
        var finalAttribute = elementAttributes[elementAttributes.length - 1];
        var finalAttributeColumn = finalAttribute.columnNumber;
        var finalAttributeLength = finalAttribute.value.length;
        endPosition = {
            line: finalAttribute.lineNumber - 1,
            character: finalAttributeColumn + finalAttributeLength + 1
        };
    }
    else {
        var elementTag = element.tagName;
        var tagLength = elementTag.length;
        var elementStartColumn = element.columnNumber;
        endPosition = {
            line: element.lineNumber - 1,
            character: elementStartColumn + tagLength
        };
    }
    return [startPosition, endPosition];
}
exports.calculateElementPositions = calculateElementPositions;
/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
function expect(value, message) {
    if (value == null) {
        throw new Error(message);
    }
    return value;
}
exports.expect = expect;
var fileExistsAt = function (filepath) { return __awaiter(void 0, void 0, void 0, function () {
    var exists, stat, err_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                exists = true;
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, fs_1["default"].promises.stat(filepath)];
            case 2:
                stat = _a.sent();
                exists = stat.isFile();
                return [3 /*break*/, 4];
            case 3:
                err_1 = _a.sent();
                exists = false;
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/, exists];
        }
    });
}); };
exports.fileExistsAt = fileExistsAt;
var fileExistsAtSync = function (filepath) {
    var exists = true;
    try {
        var stat = fs_1["default"].statSync(filepath);
        exists = stat.isFile();
    }
    catch (err) {
        exists = false;
    }
    return exists;
};
exports.fileExistsAtSync = fileExistsAtSync;
function getOrAdd(boxedMap, key, newInstance) {
    var m = boxedMap.get();
    var v = m.get(key);
    if (v !== undefined) {
        return v;
    }
    else {
        var i = newInstance();
        boxedMap.set(m.set(key, i));
        return i;
    }
}
exports.getOrAdd = getOrAdd;
function profile(fn) {
    var start = Date.now();
    var ret = fn();
    return [ret, Date.now() - start];
}
exports.profile = profile;
function profileAsync(fn) {
    return __awaiter(this, void 0, void 0, function () {
        var start, ret;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    start = Date.now();
                    return [4 /*yield*/, fn()];
                case 1:
                    ret = _a.sent();
                    return [2 /*return*/, [ret, Date.now() - start]];
            }
        });
    });
}
exports.profileAsync = profileAsync;
