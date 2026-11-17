// 生き物の件数・読み取りの上限と、読み飛ばすディレクトリ。
const MAX_PIGEONS = 14, MAX_DOGS = 3, MAX_CATS = 4;
const MAX_FILES = 300000, MAX_READ = 256 * 1024;
const SKIP_DIR = /(^|\/)(node_modules|vendor|third_party|\.git|dist|build|out|target|__fixtures__|fixtures|testdata|\.venv|venv|site-packages)(\/|$)/;

export { MAX_PIGEONS, MAX_DOGS, MAX_CATS, MAX_FILES, MAX_READ, SKIP_DIR };
