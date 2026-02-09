// Privacy Policy Tab Switching
document.querySelectorAll<HTMLButtonElement>('.privacy-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const lang = tab.dataset.lang;

        // Update tabs
        document.querySelectorAll('.privacy-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update content
        document.querySelectorAll<HTMLElement>('.privacy-content').forEach(content => {
            content.classList.remove('active');
            if (content.dataset.lang === lang) {
                content.classList.add('active');
            }
        });
    });
});

// SPA-like navigation for logo link using History API
document.getElementById('logo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Update URL without page reload
    const basePath = window.location.pathname + window.location.search;
    if (window.location.hash) {
        history.pushState(null, '', basePath || '/');
    }
    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
    const hash = window.location.hash;
    if (hash) {
        const target = document.querySelector(hash);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});
