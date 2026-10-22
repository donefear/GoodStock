---
name: fixit
description: Review the screenshots and notes in issues/ and update issues/REVIEW.txt with a breakdown of each problem and how it will be fixed, without changing any code. Use when the user says "fixit".
---

# fixit: review issues/ and update REVIEW.txt

The user drops screenshots in `issues/`. Each file name is the instruction ("allignment 2.png", "make clickable.png",
"remove.png"), and the red marks in the picture show where. They may also add free-text notes at the bottom of
`issues/REVIEW.txt`. This skill only writes the review. **Do not change any code**; the user reads the review and
confirms first.

1. **Collect the input.**
   - List `issues/`. Read every image (png, jpg, jpeg, webp, gif) with the Read tool. Treat the file name as the
     instruction and the red circles, boxes and arrows as the place it is about. Handwriting in the image counts too.
   - Read `issues/REVIEW.txt` if it exists. Keep its earlier sections. Pick up the user's own notes (usually at the
     bottom, lines starting with `-`) as extra issues. Note duplicates of screenshot issues instead of listing them twice.
   - Skip issues that the review already marks as done (a STATUS line or "done in vX.Y.Z"), unless a new screenshot
     shows the problem is still there.

2. **Find the cause in the code** for each issue before writing anything: the render function, the markup in
   `index.html`, the CSS rule (search `styles.css` for the class). Work out *why* it looks or behaves wrong, for
   example a negative margin, a `<label>` styled as a button, or a filter that is never applied. Use `file:line`
   references. Use the Explore agent only when the search is broad.

3. **Update `issues/REVIEW.txt`** (plain text, about 110 columns, same style as the existing file):
   - A header line with today's date and the version in `index.html` ("Goodstock vX.Y.Z").
   - One numbered section per issue, continuing the existing numbering:
     ```
     N. <screenshot name(s) or "note">: <where in the app>
     ------------------------------------------------
     What's wrong
       <the problem as the user sees it, then the cause in the code with file:line>
     Fix
       - <concrete change, per file>
       - CHECK: <only where the intent is unclear: the guess made, and the alternative>
     ```
   - A GENERAL section listing the project rules that apply (Chrome 81 safe, RTL logical properties, light and
     dark mode, WCAG AA colours, translations for every `lang/*.js` plus `node lang/check-translations.mjs`, a page
     test in `tests/page/`, `npm run bump`, `npm test`), and a suggested order of work.
   - Leave the user's notes in place, but say which numbered section covers each one.

4. **Reply briefly**: one line per issue (what's wrong → planned fix), then the CHECK questions the user needs to
   answer. Ask before you start fixing.

Notes
- Scratch files go in `G:\claude-scratch\kitchen-app` (little space on C:).
- Node is not installed on Windows. Run node scripts in Docker via WSL (`node:22-alpine`, repo at
  `/mnt/g/VS code - projects/kitchen app`).
- Some files use CRLF line endings (`app/ideas.js`, `lang/*.js`). Match them when editing later.
