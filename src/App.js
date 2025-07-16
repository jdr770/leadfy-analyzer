<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Leadfy Quality Analyzer</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
        const { useState, useRef, useEffect } = React;

        const LeadfyApp = () => {
            const [mainDatabase, setMainDatabase] = useState({});
            const [analysis, setAnalysis] = useState(null);
            const [loading, setLoading] = useState(false);
            const [dbStatus, setDbStatus] = useState('Aucune base chargée');
            const [clientStatus, setClientStatus] = useState('Chargez d\'abord la base principale');
            
            const mainFileRef = useRef(null);
            const clientFileRef = useRef(null);

            const normalizePhoneNumber = (phone) => {
                if (!phone) return '';
                let cleaned = String(phone).replace(/[\s\-\.\(\)]/g, '').replace(/^00/, '+').trim();
                if (cleaned.startsWith('+33')) cleaned = '0' + cleaned.substring(3);
                else if (cleaned.startsWith('33') && (cleaned.length === 11 || cleaned.length === 12)) cleaned = '0' + cleaned.substring(2);
                if (cleaned.length === 9 && !cleaned.startsWith('0')) cleaned = '0' + cleaned;
                return cleaned;
            };

            const createPhoneVariants = (phone) => {
                const normalized = normalizePhoneNumber(phone);
                const variants = new Set();
                variants.add(normalized);
                if (normalized.length === 10 && normalized.startsWith('0')) {
                    variants.add(normalized.replace(/(\d{2})(?=\d)/g, '$1 ').trim());
                    const withoutZero = normalized.substring(1);
                    variants.add(withoutZero);
                    variants.add('+33' + withoutZero);
                    variants.add('+33 ' + withoutZero);
                    variants.add('0033' + withoutZero);
                    variants.add('33' + withoutZero);
                }
                return Array.from(variants);
            };

            const detectColumns = (data) => {
                if (!data || data.length === 0) return { phone: null, source: null };
                const headers = Object.keys(data[0]);
                let phoneCol = null;
                let sourceCol = null;
                const phonePatterns = ['phone', 'telephone', 'tel', 'mobile', 'portable', 'gsm', 'numero'];
                const sourcePatterns = ['source', 'campaign', 'campagne', 'origine', 'origin', 'canal'];
                headers.forEach(header => {
                    const headerLower = header.toLowerCase();
                    if (!phoneCol && phonePatterns.some(pattern => headerLower.includes(pattern))) phoneCol = header;
                    if (!sourceCol && sourcePatterns.some(pattern => headerLower.includes(pattern))) sourceCol = header;
                });
                return { phone: phoneCol, source: sourceCol };
            };

            const readFile = (file) => {
                return new Promise((resolve, reject) => {
                    const extension = file.name.split('.').pop().toLowerCase();
                    if (extension === 'csv') {
                        Papa.parse(file, {
                            header: true,
                            dynamicTyping: false,
                            skipEmptyLines: true,
                            complete: (results) => resolve(results.data),
                            error: reject
                        });
                    } else {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                                const data = XLSX.utils.sheet_to_json(firstSheet, { raw: false });
                                resolve(data);
                            } catch (error) {
                                reject(error);
                            }
                        };
                        reader.readAsArrayBuffer(file);
                    }
                });
            };

            const handleMainFileUpload = async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                try {
                    setDbStatus('Chargement en cours...');
                    const data = await readFile(file);
                    const detected = detectColumns(data);
                    if (!detected.phone) throw new Error('Aucune colonne téléphone détectée');
                    const newDatabase = {};
                    let indexedCount = 0;
                    data.forEach(row => {
                        const phone = row[detected.phone];
                        if (phone) {
                            const variants = createPhoneVariants(phone);
                            variants.forEach(variant => {
                                newDatabase[variant] = {
                                    ...row,
                                    _originalPhone: phone,
                                    _source: row[detected.source] || 'Source inconnue'
                                };
                            });
                            indexedCount++;
                        }
                    });
                    setMainDatabase(newDatabase);
                    setDbStatus(`✅ ${indexedCount} numéros indexés`);
                    setClientStatus('Prêt pour l\'import client');
                } catch (error) {
                    setDbStatus(`❌ Erreur : ${error.message}`);
                }
            };

            const handleClientFileUpload = async (event) => {
                const file = event.target.files[0];
                if (!file || Object.keys(mainDatabase).length === 0) return;
                try {
                    setLoading(true);
                    const data = await readFile(file);
                    const detected = detectColumns(data);
                    const phoneCol = detected.phone || 'telephone';
                    const sourceProblems = {};
                    let matched = 0;
                    let unmatched = 0;
                    const unmatchedList = [];
                    data.forEach(row => {
                        const phone = row[phoneCol];
                        const status = row.status || 'invalide';
                        if (!phone) return;
                        const variants = createPhoneVariants(phone);
                        let found = false;
                        let matchedData = null;
                        for (const variant of variants) {
                            if (mainDatabase[variant]) {
                                found = true;
                                matchedData = mainDatabase[variant];
                                break;
                            }
                        }
                        if (found && matchedData) {
                            matched++;
                            const source = matchedData._source;
                            if (!sourceProblems[source]) {
                                sourceProblems[source] = { total: 0, statuses: {} };
                            }
                            sourceProblems[source].total++;
                            sourceProblems[source].statuses[status] = (sourceProblems[source].statuses[status] || 0) + 1;
                        } else {
                            unmatched++;
                            unmatchedList.push({ phone: phone, normalized: normalizePhoneNumber(phone), status: status });
                        }
                    });
                    setAnalysis({ total: data.length, matched, unmatched, sourceProblems, unmatchedList });
                    setClientStatus('✅ Analyse terminée');
                } catch (error) {
                    setClientStatus(`❌ Erreur : ${error.message}`);
                } finally {
                    setLoading(false);
                }
            };

            const downloadTemplate = () => {
                const data = [
                    ['telephone', 'status', 'commentaire'],
                    ['06 12 34 56 78', 'invalide', 'Numéro non attribué'],
                    ['+33698765432', 'doublon', 'Client déjà en base'],
                    ['0123456789', 'autre', 'Hors cible']
                ];
                const ws = XLSX.utils.aoa_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Retours_Qualite');
                XLSX.writeFile(wb, 'Modele_Retours_Telephone_Leadfy.xlsx');
            };

            const exportReport = () => {
                if (!analysis) return;
                const wb = XLSX.utils.book_new();
                const summaryData = Object.entries(analysis.sourceProblems).map(([source, data]) => ({
                    Source: source,
                    'Total problèmes': data.total,
                    'Invalides': data.statuses.invalide || 0,
                    'Doublons': data.statuses.doublon || 0,
                    'Autres': data.statuses.autre || 0
                }));
                const summarySheet = XLSX.utils.json_to_sheet(summaryData);
                XLSX.utils.book_append_sheet(wb, summarySheet, 'Résumé');
                if (analysis.unmatchedList.length > 0) {
                    const unmatchedData = analysis.unmatchedList.map(item => ({
                        'Numéro original': item.phone,
                        'Format normalisé': item.normalized,
                        'Status': item.status
                    }));
                    const unmatchedSheet = XLSX.utils.json_to_sheet(unmatchedData);
                    XLSX.utils.book_append_sheet(wb, unmatchedSheet, 'Non trouvés');
                }
                XLSX.writeFile(wb, `Rapport_Leadfy_${new Date().toISOString().split('T')[0]}.xlsx`);
            };

            return (
                <div className="min-h-screen bg-gray-100">
                    <div className="gradient-bg text-white p-8">
                        <h1 className="text-4xl font-bold text-center mb-2">Leadfy Quality Analyzer</h1>
                        <p className="text-center text-lg">Analyse par numéro de téléphone - Tous formats acceptés</p>
                    </div>
                    <div className="max-w-6xl mx-auto p-6">
                        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                            <h2 className="text-2xl font-bold mb-4">📋 Modèle pour vos clients</h2>
                            <button onClick={downloadTemplate} className="gradient-bg text-white px-6 py-2 rounded hover:shadow-lg">
                                📥 Télécharger le modèle Excel
                            </button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h3 className="text-xl font-bold mb-4">📊 Base de données</h3>
                                <div className="bg-gray-100 p-3 rounded mb-4">
                                    <p className="text-sm">{dbStatus}</p>
                                </div>
                                <div onClick={() => mainFileRef.current?.click()} className="border-2 border-dashed border-gray-400 rounded-lg p-8 text-center cursor-pointer hover:border-purple-500">
                                    <p className="text-gray-600">Cliquez pour importer</p>
                                    <input ref={mainFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleMainFileUpload} className="hidden" />
                                </div>
                            </div>
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h3 className="text-xl font-bold mb-4">📥 Retours clients</h3>
                                <div className="bg-gray-100 p-3 rounded mb-4">
                                    <p className="text-sm">{clientStatus}</p>
                                </div>
                                <div onClick={() => Object.keys(mainDatabase).length > 0 && clientFileRef.current?.click()} className={`border-2 border-dashed rounded-lg p-8 text-center ${Object.keys(mainDatabase).length > 0 ? 'border-gray-400 cursor-pointer hover:border-purple-500' : 'border-gray-300 opacity-50 cursor-not-allowed'}`}>
                                    <p className="text-gray-600">Cliquez pour importer</p>
                                    <input ref={clientFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleClientFileUpload} className="hidden" />
                                </div>
                            </div>
                        </div>
                        {loading && (
                            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
                                <p className="mt-4">Analyse en cours...</p>
                            </div>
                        )}
                        {analysis && !loading && (
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-2xl font-bold mb-6">📈 Rapport d'analyse</h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="bg-blue-50 p-4 rounded text-center">
                                        <div className="text-2xl font-bold text-blue-600">{analysis.total}</div>
                                        <div className="text-sm">Analysés</div>
                                    </div>
                                    <div className="bg-green-50 p-4 rounded text-center">
                                        <div className="text-2xl font-bold text-green-600">{analysis.matched}</div>
                                        <div className="text-sm">Trouvés</div>
                                    </div>
                                    <div className="bg-red-50 p-4 rounded text-center">
                                        <div className="text-2xl font-bold text-red-600">{analysis.unmatched}</div>
                                        <div className="text-sm">Non trouvés</div>
                                    </div>
                                    <div className="bg-purple-50 p-4 rounded text-center">
                                        <div className="text-2xl font-bold text-purple-600">{Object.keys(analysis.sourceProblems).length}</div>
                                        <div className="text-sm">Sources</div>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <button onClick={exportReport} className="gradient-bg text-white px-6 py-2 rounded hover:shadow-lg">
                                        📊 Exporter le rapport Excel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        };
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<LeadfyApp />);
    </script>
</body>
</html>
