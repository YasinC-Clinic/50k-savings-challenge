# 50K Savings Challenge

An offline-first, private Progressive Web App for a 50,000 SEK savings challenge from 1 January to 30 June 2027.

## Local development

```bash
npm install
npm run dev
```

Run the quality checks with `npm test`, `npm run lint`, and `npm run build`.

## GitHub Pages

The deployment workflow is ready at `.github/workflows/deploy-pages.yml`. Once this folder is committed to a GitHub repository:

1. Push the `main` branch.
2. In GitHub repository settings, open **Pages** and select **GitHub Actions** as the source.
3. The workflow publishes the app at `https://<owner>.github.io/<repository>/` for a project site, or `https://<owner>.github.io/` for an organization site.

## iPhone installation

Open the published URL in Safari, choose **Share**, then **Add to Home Screen**. The app works offline after its first successful load. Your savings data is stored locally in the browser; export a backup regularly.
