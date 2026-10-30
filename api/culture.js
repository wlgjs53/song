// Vercel 서버 함수: 제주 역사문화 일반정보 + 위치정보 API를 호출해 하나로 합쳐 돌려준다.
// API 키는 브라우저로 나가지 않고, Vercel 환경변수에서만 읽는다.
//   JEJU_CULTURE_INFO_KEY      제주역사문화일반정보 키
//   JEJU_CULTURE_LOCATION_KEY  제주역사문화위치정보 키
// API 요청 주소는 공공데이터포털(odcloud) Swagger 명세에 공개된 값이라 코드에 둔다. (키가 아님)
//   일반정보: https://infuser.odcloud.kr/oas/docs?namespace=15109587/v1
//   위치정보: https://infuser.odcloud.kr/oas/docs?namespace=15109570/v1
// 테스트할 때만 JEJU_CULTURE_INFO_URL / JEJU_CULTURE_LOCATION_URL 환경변수로 주소를 바꿀 수 있다.
const INFO_URL_DEFAULT = "https://api.odcloud.kr/api/15109587/v1/uddi:56c2b3a4-4b4b-46cd-a1fa-f928ef731ffb";
const LOC_URL_DEFAULT = "https://api.odcloud.kr/api/15109570/v1/uddi:8781448b-81a8-487c-bc95-d26335bafa82";

const PER_PAGE = 200;

async function fetchAll(baseUrl, key) {
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const u = new URL(baseUrl);
    u.searchParams.set("serviceKey", key.includes("%") ? decodeURIComponent(key) : key);   // 인코딩된 키를 넣어도 두 번 인코딩되지 않게
    u.searchParams.set("page", String(page));
    u.searchParams.set("perPage", String(PER_PAGE));
    u.searchParams.set("returnType", "JSON");
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("upstream status " + r.status);   // 주소(키 포함)는 오류 메시지에 넣지 않는다
    const j = await r.json();
    const data = Array.isArray(j.data) ? j.data : [];
    rows.push(...data);
    if (!data.length || rows.length >= (j.totalCount ?? j.matchCount ?? rows.length)) break;
  }
  return rows;
}

const pick = (row, ...names) => {
  for (const n of names) if (row[n] != null && row[n] !== "" && row[n] !== "해당없음") return String(row[n]).trim();
  return "";
};

module.exports = async (req, res) => {
  const infoKey = process.env.JEJU_CULTURE_INFO_KEY, locKey = process.env.JEJU_CULTURE_LOCATION_KEY;
  const infoUrl = process.env.JEJU_CULTURE_INFO_URL || INFO_URL_DEFAULT;
  const locUrl = process.env.JEJU_CULTURE_LOCATION_URL || LOC_URL_DEFAULT;
  if (!infoKey || !locKey) {
    return res.status(503).json({ error: "api-not-configured" });
  }
  try {
    const [info, loc] = await Promise.all([fetchAll(infoUrl, infoKey), fetchAll(locUrl, locKey)]);
    const locById = new Map(loc.map(r => [pick(r, "데이터 고유번호"), r]));
    const data = info.map(r => {
      const id = pick(r, "데이터 고유번호");
      const l = locById.get(id) || {};
      const la = parseFloat(pick(l, "위도") || pick(r, "위도"));
      const lo = parseFloat(pick(l, "경도") || pick(r, "경도"));
      if (!(la > 33 && la < 34 && lo > 126 && lo < 127.2)) return null;   // 좌표가 없거나 제주 밖이면 제외
      return {
        i: Number(id), n: pick(r, "장소명") || pick(l, "장소명"), la, lo,
        ad: pick(l, "위치").replace(/^제주특별자치도\s*/, ""),
        u: pick(l, "상세보기 URL", "데이터 상세보기 URL", "상세보기URL"),
        c: pick(r, "분류"), d1: pick(r, "디렉토리1"), d2: pick(r, "디렉토리2"),
        t: pick(r, "제목"), st: pick(r, "부제목"), au: pick(r, "저작자"), kw: pick(r, "주제"),
        ab: pick(r, "초록"), ct: pick(r, "내용"), pd: pick(r, "발행일"),
      };
    }).filter(Boolean);
    if (!data.length) throw new Error("empty");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ source: "api", count: data.length, data });
  } catch (e) {
    return res.status(502).json({ error: "upstream-failed" });
  }
};
