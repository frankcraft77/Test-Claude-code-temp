/* Per-project settings. Everything visual lives in theme.css. */
window.APP_CONFIG = {
  /* 'deck' = swipe through cards horizontally (story style)
     'feed' = one vertical scrolling page of cards            */
  MODE: 'deck',

  /* Fallback top-bar title, used before data loads and for
     rows that leave the title column empty.                  */
  APP_TITLE: 'Story Deck',

  /* If set, shows an X button in the top bar linking here.
     Leave '' to hide the button.                             */
  CLOSE_URL: '',

  /* Where the app reads cards and sends answers.
     Docker / Node server (default):
       CONTENT_URL: '/api/content',  SUBMIT_URL: '/api/submit'
     Shared hosting (files uploaded to a subdomain, PHP):
       CONTENT_URL: 'content.csv',   SUBMIT_URL: 'submit.php'
     Display-only (no backend at all): set SUBMIT_URL to '' —
     input cards are then skipped and only story cards show.  */
  CONTENT_URL: '/api/content',
  SUBMIT_URL: '/api/submit'
};
