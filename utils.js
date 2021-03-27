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

const LOGIN_URL = 'https://gopro.com/login';
const getMediaPageUrl = pageNum => `https://api.gopro.com/media/search?fields=camera_model,captured_at,content_title,content_type,created_at,gopro_user_id,gopro_media,file_size,height,fov,id,item_count,moments_count,on_public_profile,orientation,play_as,ready_to_edit,ready_to_view,resolution,source_duration,token,type,width&processing_states=pretranscoding,transcoding,failure,ready&order_by=captured_at&per_page=100&page=${pageNum}`;
const getDownloadUrl = item => `https://api.gopro.com/media/${item.id}/download`;

module.exports = {
	checkHttpStatus,
	httpCheckParse,
	clone,
	pluralise,
	stripFields,
	LOGIN_URL,
	getMediaPageUrl,
	getDownloadUrl
};
