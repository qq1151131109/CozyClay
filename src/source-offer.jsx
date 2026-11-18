// SPDX-License-Identifier: MIT

const SOURCE_URL = import.meta.env.VITE_SOURCE_CODE_URL || "https://github.com/HaD0Yun/CozyClay";

/** Source-code link shown in the Studio footer. */
export default function SourceOffer() {
	return (
		<a className="source-offer" href={SOURCE_URL} target="_blank" rel="noreferrer">
			Source code (MIT)
		</a>
	);
}
