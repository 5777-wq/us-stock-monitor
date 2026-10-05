/* api-push.mjs —— github.com git 通道被墙时，经 gh CLI 走 API 推送
   blob(base64) → tree(base_tree=远端 HEAD 树) → commit(parent=远端 HEAD) → fast-forward ref。
   推送范围：远端HEAD..HEAD 变更的源码文件，内容取自本地 HEAD 对象（git cat-file）。
   防护 [FIX-07]：
   · 祖先校验——远端 HEAD 必须是本地 HEAD 的祖先（禁止凭旧树推送/覆盖远端新提交）；
   · 白名单——只推源码：out/（报告）与 app/（APK）由 Actions 发布，android/signing/ 凭据绝不入库；
   · 删除检测——含 D（删除）时明确报错（base_tree 模式不会替你删远端文件），改走普通 git push；
   · --dry-run——只打印将推送的文件与目标 parent，不创建 blob/commit/ref。 */
import { execFileSync } from 'node:child_process';

const REPO = '5777-wq/us-stock-monitor';
const BRANCH = 'main';
const dryRun = process.argv.includes('--dry-run');
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const api = (path, method, body) => {
  const args = ['api'];
  if (method) args.push('--method', method, '--input', '-');
  args.push(path);
  return JSON.parse(execFileSync('gh', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
};

/* 生成物/凭据白名单：这些目录的内容本地永远是旧副本或私有文件，绝不推 */
const EXCLUDE = (f) => f.startsWith('out/') || f.startsWith('app/') || f.startsWith('android/signing/');

for (let attempt = 1; attempt <= 3; attempt++) {
  const head = api(`/repos/${REPO}/git/ref/heads/${BRANCH}`).object.sha;

  // 祖先校验：远端 HEAD 不是本地 HEAD 祖先 = 本地落后（或分叉），凭旧树推送会顶掉远端新提交
  try { git(['merge-base', '--is-ancestor', head, 'HEAD']); }
  catch {
    console.error(`✗ 远端 ${BRANCH} 有本地没有的提交（${head.slice(0, 10)}）——先 git fetch origin && git rebase origin/${BRANCH} 再推送`);
    process.exit(2);
  }

  const status = git(['diff', '--name-status', `${head}..HEAD`]).split('\n').filter(Boolean);
  const deleted = status.filter((l) => l.startsWith('D'));
  if (deleted.length) {
    console.error(`✗ 检测到删除（本工具 base_tree 模式不会同步删除到远端，直接推会让两端树分叉）：\n  ${deleted.join('\n  ')}\n请改用普通 git push 完成含删除的提交`);
    process.exit(3);
  }
  // R100\told\tnew 取 new（重命名后路径）；M/A 行即路径本身
  const files = status.map((l) => l.split('\t').pop()).filter(Boolean).filter((f) => !EXCLUDE(f));
  if (!files.length) { console.log('本地与远端已一致（源码范围），无需推送'); process.exit(0); }

  const msg = git(['log', '-1', '--format=%B']).trim();
  console.log(`attempt ${attempt} — parent ${head.slice(0, 10)}，将推送 ${files.length} 个文件：\n  ${files.join('\n  ')}`);
  if (dryRun) { console.log('（--dry-run：不创建 blob/commit/ref）'); process.exit(0); }

  const baseTree = api(`/repos/${REPO}/git/commits/${head}`).tree.sha;
  const tree = [];
  for (const p of files) {
    const buf = git(['cat-file', 'blob', `HEAD:${p}`], { encoding: 'buffer' }); // 不经 shell，路径注入无门
    const blob = api(`/repos/${REPO}/git/blobs`, 'POST', { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  blob', p, blob.sha.slice(0, 8));
  }
  const newTree = api(`/repos/${REPO}/git/trees`, 'POST', { base_tree: baseTree, tree });
  const commit = api(`/repos/${REPO}/git/commits`, 'POST', { message: msg, tree: newTree.sha, parents: [head] });
  try {
    api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha, force: false });
    console.log('PUSHED via API:', commit.sha.slice(0, 10), '(parent', head.slice(0, 10) + ')');
    // 推送后立即对齐本地远端引用，防止下一轮 diff/推送凭旧游标分叉 [FIX-01 教训]
    try { git(['update-ref', `refs/remotes/origin/${BRANCH}`, commit.sha]); } catch { /* 本地无该仓库布局时忽略 */ }
    console.log(`已更新 refs/remotes/origin/${BRANCH}；本地分支请 git reset --hard origin/${BRANCH} 对齐`);
    process.exit(0);
  } catch (e) { console.log('ref 更新被拒（远端有新提交），重试', String(e).slice(0, 120)); }
}
console.error('API push failed after retries'); process.exit(1);
