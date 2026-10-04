/* api-push.mjs —— github.com git 通道被墙时，经 gh CLI 走 API 推送
   blob(base64) → tree(base_tree=远端 HEAD 树) → commit(parent=远端 HEAD) → fast-forward ref。
   推送范围：origin/main..HEAD 变更的文件，内容取自本地 HEAD 对象（git cat-file）。 */
import { execSync } from 'node:child_process';
const REPO = '5777-wq/us-stock-monitor';
const api = (path, method, body) => {
  const args = ['gh', 'api'];
  if (method) args.push('--method', method, '--input', '-');
  args.push(path);
  return JSON.parse(execSync(args.join(' '), { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
};
for (let attempt = 1; attempt <= 3; attempt++) {
  // 只推源码：out/（收盘报告）由 Actions 云端生成、app/（APK）由 android-apk workflow 发布，
  // 本地这两处是旧副本，绝不能随 API 推送回滚远端最新产物
  const files = execSync('git diff --name-only origin/main..HEAD', { encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('out/') && !f.startsWith('app/'));
  if (!files.length) { console.log('本地与远端已一致，无需推送'); process.exit(0); }
  const msg = execSync('git log -1 --format=%B', { encoding: 'utf8' }).trim();
  console.log('attempt', attempt, '- files:', files.length);
  const head = api(`/repos/${REPO}/git/ref/heads/main`).object.sha;
  const baseTree = api(`/repos/${REPO}/git/commits/${head}`).tree.sha;
  const tree = [];
  for (const p of files) {
    const b64 = execSync(`git cat-file blob HEAD:"${p}"`, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).toString('base64');
    const blob = api(`/repos/${REPO}/git/blobs`, 'POST', { content: b64, encoding: 'base64' });
    tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  blob', p, blob.sha.slice(0, 8));
  }
  const newTree = api(`/repos/${REPO}/git/trees`, 'POST', { base_tree: baseTree, tree });
  const commit = api(`/repos/${REPO}/git/commits`, 'POST', { message: msg, tree: newTree.sha, parents: [head] });
  try {
    api(`/repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: commit.sha, force: false });
    console.log('PUSHED via API:', commit.sha.slice(0, 10), '(parent', head.slice(0, 10) + ')');
    process.exit(0);
  } catch (e) { console.log('ref 更新被拒（远端有新提交），重试', String(e).slice(0, 120)); }
}
console.error('API push failed after retries'); process.exit(1);
