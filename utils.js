const checkHttpStatus = res => {
	if ([200, 201, 204].includes(res.status)) {
		return res;
	}
	
	throw Error(`${res.status} ${res.statusText}`);
};

const httpCheckParse = res => checkHttpStatus(res).json();

const clone = x => JSON.parse(JSON.stringify(x));

const pluralise = (word, arr) => {
	if (arr.length === 1) {
		return word;
	}
	
	return `${word}s`;
}

const stripFields = (originalObj, fields = []) => {
	const obj = clone(originalObj);
	fields.forEach(field => delete obj[field]);
	
	return obj;
}

module.exports = {
	checkHttpStatus,
	httpCheckParse,
	clone,
	pluralise,
	stripFields
};