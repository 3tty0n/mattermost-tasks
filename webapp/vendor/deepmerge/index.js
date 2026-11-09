// Minimal, prototype-poisoning-safe implementation of the deepmerge 4.x API used by Jest.
function isNonNullObject(value) {
    return Boolean(value) && typeof value === 'object';
}

function isSpecial(value) {
    const tag = Object.prototype.toString.call(value);
    return tag === '[object RegExp]' || tag === '[object Date]';
}

function defaultIsMergeableObject(value) {
    return isNonNullObject(value) && !isSpecial(value);
}

function emptyTarget(value) {
    return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
    return options.clone !== false && options.isMergeableObject(value) ? deepmerge(emptyTarget(value), value, options) : value;
}

function defaultArrayMerge(target, source, options) {
    return target.concat(source).map((element) => cloneUnlessOtherwiseSpecified(element, options));
}

function getMergeFunction(key, options) {
    if (!options.customMerge) {
        return deepmerge;
    }
    const customMerge = options.customMerge(key);
    return typeof customMerge === 'function' ? customMerge : deepmerge;
}

function getEnumerableOwnPropertySymbols(target) {
    return Object.getOwnPropertySymbols ?
        Object.getOwnPropertySymbols(target).filter((symbol) => Object.propertyIsEnumerable.call(target, symbol)) :
        [];
}

function getKeys(target) {
    return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target));
}

function propertyIsOnObject(object, property) {
    try {
        return property in object;
    } catch {
        return false;
    }
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function propertyIsUnsafe(target, key) {
    return UNSAFE_KEYS.has(key) ||
        (propertyIsOnObject(target, key) &&
            !(Object.hasOwnProperty.call(target, key) && Object.propertyIsEnumerable.call(target, key)));
}

function mergeObject(target, source, options) {
    const destination = {};
    if (options.isMergeableObject(target)) {
        getKeys(target).forEach((key) => {
            destination[key] = cloneUnlessOtherwiseSpecified(target[key], options);
        });
    }
    getKeys(source).forEach((key) => {
        if (propertyIsUnsafe(target, key)) {
            return;
        }
        if (propertyIsOnObject(target, key) && options.isMergeableObject(source[key])) {
            destination[key] = getMergeFunction(key, options)(target[key], source[key], options);
        } else {
            destination[key] = cloneUnlessOtherwiseSpecified(source[key], options);
        }
    });
    return destination;
}

function deepmerge(target, source, options) {
    const settings = options || {};
    settings.arrayMerge = settings.arrayMerge || defaultArrayMerge;
    settings.isMergeableObject = settings.isMergeableObject || defaultIsMergeableObject;
    settings.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

    const sourceIsArray = Array.isArray(source);
    const targetIsArray = Array.isArray(target);
    if (sourceIsArray !== targetIsArray) {
        return cloneUnlessOtherwiseSpecified(source, settings);
    }
    if (sourceIsArray) {
        return settings.arrayMerge(target, source, settings);
    }
    return mergeObject(target, source, settings);
}

deepmerge.all = (array, options) => {
    if (!Array.isArray(array)) {
        throw new Error('first argument should be an array');
    }
    return array.reduce((previous, next) => deepmerge(previous, next, options), {});
};

module.exports = deepmerge;
