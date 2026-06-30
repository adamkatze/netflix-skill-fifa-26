//------------------------------------------------------------------------------
// Analytics page
//
// Reads the logged games from the server's /analytics route and renders a
// human-readable table, with a button to export everything as CSV.
//------------------------------------------------------------------------------

let analyticsRows = [];


function initAnalytics() {
    fetch('/analytics')
        .then(response => response.json())
        .then(rows => {
            analyticsRows = Array.isArray(rows) ? rows : [];
            renderTable();
        })
        .catch(err => {
            document.getElementById('anTableWrap').innerHTML =
                '<p class="anEmpty">Could not load analytics: ' + err + '</p>';
        });
}


// Only the game-log rows (the analytics table could hold other events later).
function gameRows() {
    return analyticsRows.filter(r => r.action === 'game');
}


function renderTable() {
    const wrap = document.getElementById('anTableWrap');
    const games = gameRows().slice().sort((a, b) => b.id - a.id);   // newest first

    document.getElementById('anCount').textContent =
        games.length + (games.length === 1 ? ' game' : ' games');

    if (!games.length) {
        wrap.innerHTML = '<p class="anEmpty">No games logged yet.</p>';
        return;
    }

    let html = '<table class="anTable"><thead><tr>'
        + '<th>#</th><th>Started</th><th>Mode</th>'
        + '<th>Lane 1</th><th>Lane 2</th><th>Length</th>'
        + '</tr></thead><tbody>';

    games.forEach(g => {
        html += '<tr>'
            + '<td>' + g.id + '</td>'
            + '<td>' + formatDate(g.started_at) + '</td>'
            + '<td>' + formatMode(g) + '</td>'
            + '<td>' + laneCell(g.lane1_active, g.lane1_score) + '</td>'
            + '<td>' + laneCell(g.lane2_active, g.lane2_score) + '</td>'
            + '<td>' + formatLength(g.game_length_ms) + '</td>'
            + '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}


//--------------------------------- Formatting ---------------------------------

function formatDate(iso) {
    if (!iso) return '&mdash;';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatLength(ms) {
    if (ms == null) return '&mdash;';
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + (seconds < 10 ? '0' + seconds : seconds);
}

function formatMode(g) {
    if (g.lane1_active && g.lane2_active) return '2 Player';
    if (g.lane1_active) return 'Solo &middot; Lane 1';
    if (g.lane2_active) return 'Solo &middot; Lane 2';
    return '&mdash;';
}

// Show the score, or a dash when that lane wasn't part of the game.
function laneCell(active, score) {
    if (!active) return '<span class="anInactive">&mdash;</span>';
    return score != null ? score : 0;
}


//--------------------------------- CSV export ---------------------------------

function downloadCSV() {
    const games = gameRows().slice().sort((a, b) => a.id - b.id);   // oldest first
    if (!games.length) return;

    const headers = [
        'id', 'started_at', 'mode',
        'lane1_active', 'lane1_score',
        'lane2_active', 'lane2_score',
        'game_length_ms', 'game_length_seconds'
    ];

    const lines = [headers.join(',')];

    games.forEach(g => {
        const lengthMs = g.game_length_ms != null ? g.game_length_ms : 0;
        const row = [
            g.id,
            g.started_at || '',
            csvMode(g),
            g.lane1_active ? 1 : 0,
            g.lane1_score != null ? g.lane1_score : 0,
            g.lane2_active ? 1 : 0,
            g.lane2_score != null ? g.lane2_score : 0,
            lengthMs,
            Math.round(lengthMs / 1000)
        ];
        lines.push(row.map(csvEscape).join(','));
    });

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'game-analytics.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Plain-text mode label for the CSV (no HTML entities).
function csvMode(g) {
    if (g.lane1_active && g.lane2_active) return '2 Player';
    if (g.lane1_active) return 'Solo - Lane 1';
    if (g.lane2_active) return 'Solo - Lane 2';
    return '';
}

function csvEscape(value) {
    const s = String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}
