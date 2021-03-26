const checkHttpStatus = res => {
	if ([200, 201, 204].includes(res.status)) {
		return res;
	}
	
	throw Error(`${res.status} ${res.statusText}`);
};

const httpCheckParse = res => checkHttpStatus(res).json();

module.exports = {
	checkHttpStatus,
	httpCheckParse
};