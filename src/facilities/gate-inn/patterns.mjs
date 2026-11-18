// 走査と公開入口が同じ正規表現を共有し、lastIndex の状態を保つ。
// ---------- 宿屋・門・酒場の名簿で使う受付の道 ----------
export const SERVERISH = /\b(createServer|express\s*\(|fastify\s*\(|new\s+Koa|new\s+Hono|Router\s*\(|APIRouter|Blueprint\s*\(|Flask\s*\(|FastAPI\s*\(|gin\.(Default|New)\s*\(|echo\.New\s*\(|fiber\.New\s*\(|chi\.NewRouter|mux\.NewRouter|http\.HandleFunc|http\.NewServeMux|(req|request)\.(url|method|path)\b|Rails\.application\.routes)/;
export const ROUTE_CALL = /\b(?:app|router|server|api|fastify|routes?|hono|srv|admin|v\d)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/gi;
export const PY_ROUTE = /@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*['"](\/[^'"]*)['"]([^)\n]*)\)/g;
export const GO_ROUTE = /\.(?:HandleFunc|Handle)\(\s*"(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^"\s]*)"|\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"\s]*)"/g;
export const RB_ROUTE = /^\s*(get|post|put|patch|delete)\s+['"](\/?[^'"]+)['"]/gm;
export const API_LITERAL = /['"`](\/api(?:\/[A-Za-z0-9_\-:{}.]+)*\/?)['"`]/g;
export const SPEC_FILE = /^((openapi|swagger|asyncapi)([-_.][\w-]+)*\.(ya?ml|json)|[\w.-]+\.(graphql|graphqls|gql)|[\w.-]+\.proto)$/i;
export const PROMPT_FILE = /(\.prompt(\.(md|txt|ya?ml|json))?|\.prompty)$|^((system|user)[-_]?)?prompts?([-_.][\w-]+)*\.(md|txt|ya?ml|json|j2|jinja2?|hbs|mustache|tmpl|tpl)$/i;
