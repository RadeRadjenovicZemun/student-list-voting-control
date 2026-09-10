
      let cachedConfig = null;

      const sidebar = document.getElementById('sidebar');
      const sidebarPin = document.getElementById('sidebarPin');
      const sidebarResizeHandle = document.getElementById('sidebarResizeHandle');
      const appGrid = document.querySelector('.app-grid');
      const SIDEBAR_MIN = 72;
      const SIDEBAR_DEFAULT = 260;
      const SIDEBAR_COLLAPSED = 18;
      let sidebarPinned = true;
      let sidebarHovered = true;
      let sidebarWidth = SIDEBAR_DEFAULT;
      let resizingSidebar = false;

      let activeLanguage = 'sr';
      let activeElectionFamily = 'parliamentary';
      let activeParliamentaryPhase = null;
      let activePresidentialPhase = null;
      let activeLocalPhase = null;
      let coverageRegionFilter = 'ALL';
      let coverageTimelineResolutionMinutes = 15;
      let coverageConfigVersionToken = null;
      let coverageTimelineSnapshots = [];
      let resultsChartSplitRatio = 1 / 3;
      let irregularitiesRecords = [];
      let irregularitiesFilter = { type: 'all', value: 'all' };
      let irregularitiesTreeBuiltForConfig = null;
      let selectedIrregularityId = null;
      let zapRecords = [];
      let zapFilter = { type: 'all', value: 'all' };
      let zapTreeBuiltForConfig = null;
      let selectedZapRecordId = null;
      let selectedResultsRegionId = 'ALL';
      const RESULT_CANDIDATE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#475569'];
      const COVERAGE_STATUS_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0f766e', '#ea580c', '#475569'];

      function getLanguageConfig(config, language = activeLanguage) {
        const multi = config && config.multiLanguage && typeof config.multiLanguage === 'object' ? config.multiLanguage : {};
        const lang = multi[language] ? language : (config && config.defaultLanguage && multi[config.defaultLanguage] ? config.defaultLanguage : 'sr');
        return multi[lang] || {
          title: config && (config.title || 'TBD'),
          dashboard: config && (config.dashboard || 'Dashboard'),
          navigation: config && (config.navigation || [
            { id: 'izlaznost', label: 'Izlaznost' },
            { id: 'rezultati', label: 'Izborni rezultati' },
            { id: 'debug', label: 'Alati' }
          ])
        };
      }

      function getLocaleDictionary(language = activeLanguage) {
        const multi = cachedConfig && cachedConfig.multiLanguage && typeof cachedConfig.multiLanguage === 'object' ? cachedConfig.multiLanguage : {};
        const lang = multi[language] ? language : (cachedConfig && cachedConfig.defaultLanguage && multi[cachedConfig.defaultLanguage] ? cachedConfig.defaultLanguage : 'sr');
        return (multi[lang] && multi[lang].ui) || (multi.sr && multi.sr.ui) || (multi.en && multi.en.ui) || {};
      }

      const IRREGULARITY_CATEGORY_OPTIONS = {
        urgency: [
          { value: 1, key: 'irregularitiesUrgencyUrgent', fallback: 'Urgent' },
          { value: 2, key: 'irregularitiesUrgencyPrioritize', fallback: 'Prioritize' },
          { value: 3, key: 'irregularitiesUrgencyNormal', fallback: 'Normal' }
        ],
        violation: [
          { value: 1, key: 'irregularitiesViolationMisdemeanor', fallback: 'Misdemeanor' },
          { value: 2, key: 'irregularitiesViolationElectoralLaw', fallback: 'Violation of electoral law' },
          { value: 3, key: 'irregularitiesViolationVotingRights', fallback: 'Violation of voting rights' },
          { value: 4, key: 'irregularitiesViolationPhysicalViolence', fallback: 'Physical violence' }
        ],
        severity: [
          { value: 1, key: 'irregularitiesSeverityCritical', fallback: 'Critical' },
          { value: 2, key: 'irregularitiesSeverityMajor', fallback: 'Major' },
          { value: 3, key: 'irregularitiesSeverityMinor', fallback: 'Minor' }
        ]
      };

      const IRREGULARITY_CATEGORY_LABELS = {
        urgency: { key: 'irregularitiesUrgency', fallback: 'Urgency' },
        violation: { key: 'irregularitiesViolation', fallback: 'Violation' },
        severity: { key: 'irregularitiesSeverity', fallback: 'Severity' }
      };

      function normalizeIrregularityCategory(category, value) {
        const number = Number(value);
        const options = IRREGULARITY_CATEGORY_OPTIONS[category] || [];
        return options.some((option) => option.value === number) ? number : 0;
      }

      function getIrregularityCategoryText(category, value, locale = getLocaleDictionary()) {
        const number = normalizeIrregularityCategory(category, value);
        const option = (IRREGULARITY_CATEGORY_OPTIONS[category] || []).find((item) => item.value === number);
        return option ? (locale[option.key] || option.fallback) : '';
      }

      function getIrregularityCategoryLabel(category, locale = getLocaleDictionary()) {
        const label = IRREGULARITY_CATEGORY_LABELS[category];
        return label ? (locale[label.key] || label.fallback) : category;
      }

      function renderIrregularityCategorySummary(source, locale = getLocaleDictionary()) {
        return ['urgency', 'violation', 'severity'].map((category) => {
          const text = getIrregularityCategoryText(category, source && source[category], locale);
          if (!text) return '';
          return `<div>${escapeHtml(text)}</div>`;
        }).join('');
      }

      function updateIrregularityCategorySummary() {
        const documentEl = document.getElementById('irregularityPreviewDocument');
        const summary = documentEl?.querySelector('.category-summary');
        if (!documentEl || !summary) return;
        summary.innerHTML = renderIrregularityCategorySummary({
          urgency: documentEl.dataset.urgency,
          violation: documentEl.dataset.violation,
          severity: documentEl.dataset.severity
        });
      }

      function populateIrregularityCategoryControls() {
        const locale = getLocaleDictionary();
        ['urgency', 'violation', 'severity'].forEach((category) => {
          const select = document.getElementById(`irregularityPreview${category[0].toUpperCase()}${category.slice(1)}Select`);
          if (!select) return;
          const currentValue = select.value || '0';
          select.innerHTML = `<option value="0">${escapeHtml(getIrregularityCategoryLabel(category, locale))}</option>${(IRREGULARITY_CATEGORY_OPTIONS[category] || []).map((option) => `<option value="${option.value}">${escapeHtml(locale[option.key] || option.fallback)}</option>`).join('')}`;
          select.value = currentValue;
        });
      }

      function setIrregularityCategoryControls(record) {
        ['urgency', 'violation', 'severity'].forEach((category) => {
          const value = String(normalizeIrregularityCategory(category, record && record[category]));
          const select = document.getElementById(`irregularityPreview${category[0].toUpperCase()}${category.slice(1)}Select`);
          if (select) select.value = value;
          const documentEl = document.getElementById('irregularityPreviewDocument');
          if (documentEl) documentEl.dataset[category] = value;
        });
        updateIrregularityCategorySummary();
      }

      function setIrregularitiesActionsVisibility(panel) {
        const actions = document.getElementById('irregularitiesActions');
        if (actions) actions.hidden = panel !== 'irregularities' && panel !== 'zap-records';
        if (panel === 'zap-records') updateZapPreviewButton();
        else if (panel === 'irregularities') updateIrregularityPreviewButton();
      }

      function setZapLabels() {
        const locale = getLocaleDictionary();
        const title = document.getElementById('zapTreeTitle');
        if (title) title.textContent = locale.irregularitiesTreeTitle || 'Voting places';
        const headers = { zapDateHeader: locale.irregularitiesDate || 'Date', zapTimeHeader: locale.irregularitiesTime || 'Time', zapPlaceHeader: locale.irregularitiesPlace || 'Voting place' };
        Object.entries(headers).forEach(([id, text]) => { const element = document.getElementById(id); if (element) element.textContent = text; });
      }

      function refreshLocalizedStaticLabels() {
        const locale = getLocaleDictionary();
        const irregularityPreviewBtn = document.getElementById('irregularityPreviewBtn');
        if (irregularityPreviewBtn) irregularityPreviewBtn.textContent = locale.irregularitiesPreview || 'Preview';
        const previewTitle = document.getElementById('irregularityPreviewTitle');
        if (previewTitle) previewTitle.textContent = locale.irregularitiesPreviewTitle || 'Voting irregularity incident report';
        const previewFile = document.getElementById('irregularityPreviewFileBtn');
        if (previewFile) previewFile.textContent = locale.irregularitiesFile || 'File';
        const previewSave = document.getElementById('irregularityPreviewSaveBtn');
        if (previewSave) previewSave.textContent = locale.irregularitiesSave || 'Save';
        const previewSaveAs = document.getElementById('irregularityPreviewSaveAsBtn');
        if (previewSaveAs) previewSaveAs.textContent = locale.irregularitiesSaveAs || 'Print PDF';
        populateIrregularityCategoryControls();
        const irregularitiesTreeTitle = document.getElementById('irregularitiesTreeTitle');
        if (irregularitiesTreeTitle) irregularitiesTreeTitle.textContent = locale.irregularitiesTreeTitle || 'Voting places';
        const timeLabel = document.querySelector('.time-label');
        if (timeLabel && locale.bannerTime) timeLabel.textContent = locale.bannerTime;

        const configFooter = document.getElementById('sidebarConfigFooter');
        if (configFooter && locale.config) {
          configFooter.textContent = locale.config;
        }

        const pageTitle = document.getElementById('pageTitle');
        if (pageTitle && !document.querySelector('.menu-item.active') && locale.turnout) {
          pageTitle.textContent = locale.turnout;
        }

        const turnoutTabs = locale.turnoutTabs || {};
        const turnoutPerRegionTab = document.querySelector('[data-turnout-tab="turnout-tab-per-region"]');
        if (turnoutPerRegionTab) turnoutPerRegionTab.textContent = turnoutTabs.perRegion || 'Turnout per Region';
        const turnoutCoverageTab = document.querySelector('[data-turnout-tab="turnout-tab-coverage"]');
        if (turnoutCoverageTab) turnoutCoverageTab.textContent = turnoutTabs.coverage || 'Coverage';

        const resultsTabs = locale.resultsTabs || {};
        const resultsPerRegionTab = document.querySelector('[data-results-tab="results-tab-per-region"]');
        if (resultsPerRegionTab) resultsPerRegionTab.textContent = resultsTabs.perRegion || 'Results per Region';
        const resultsCoverageTab = document.querySelector('[data-results-tab="results-tab-coverage"]');
        if (resultsCoverageTab) resultsCoverageTab.textContent = resultsTabs.coverage || 'Coverage';

        const cards = document.getElementById('regionCards');
        if (cards && cards.children.length) {
          const cardTitle1 = cards.children[0]?.querySelector('h3');
          const cardTitle2 = cards.children[1]?.querySelector('h3');
          const cardTitle3 = cards.children[2]?.querySelector('h3');
          const cardTitle4 = cards.children[3]?.querySelector('h3');
          const cardTitle5 = cards.children[4]?.querySelector('h3');
          if (cardTitle1 && locale.totalRegistered) cardTitle1.textContent = locale.totalRegistered;
          if (cardTitle2 && locale.totalVotingPlaces) cardTitle2.textContent = locale.totalVotingPlaces;
          if (cardTitle3 && locale.totalVoted) cardTitle3.textContent = locale.totalVoted;
          if (cardTitle4 && locale.duration) cardTitle4.textContent = locale.duration;
          if (cardTitle5 && locale.coverage) cardTitle5.textContent = locale.coverage;
          const turnoutInPlaceLabel = document.getElementById('totalCollectedInPlaceLabel');
          const turnoutFromHomeLabel = document.getElementById('totalCollectedFromHomeLabel');
          if (turnoutInPlaceLabel && locale.turnoutInPlaceLabel) turnoutInPlaceLabel.textContent = locale.turnoutInPlaceLabel;
          if (turnoutFromHomeLabel && locale.turnoutFromHomeLabel) turnoutFromHomeLabel.textContent = locale.turnoutFromHomeLabel;
          const registeredControllersLabel = cards.querySelector('.coverage-registered');
          const activeControllersLabel = cards.querySelector('.coverage-active');
          if (registeredControllersLabel && locale.registeredControllers) registeredControllersLabel.textContent = locale.registeredControllers;
          if (activeControllersLabel && locale.activeControllers) activeControllersLabel.textContent = locale.activeControllers;
        }

        const resultsCards = document.getElementById('resultsRegionCards');
        if (resultsCards && resultsCards.children.length) {
          const cardTitle1 = resultsCards.children[0]?.querySelector('h3');
          const cardTitle2 = resultsCards.children[1]?.querySelector('h3');
          const cardTitle3 = resultsCards.children[2]?.querySelector('h3');
          const cardTitle4 = resultsCards.children[3]?.querySelector('h3');
          const cardTitle5 = resultsCards.children[4]?.querySelector('h3');
          if (cardTitle1 && locale.totalRegistered) cardTitle1.textContent = locale.totalRegistered;
          if (cardTitle2 && locale.totalVotingPlaces) cardTitle2.textContent = locale.totalVotingPlaces;
          if (cardTitle3 && locale.totalVoted) cardTitle3.textContent = locale.totalVoted;
          if (cardTitle4 && locale.duration) cardTitle4.textContent = locale.duration;
          if (cardTitle5 && locale.coverage) cardTitle5.textContent = locale.coverage;
          const turnoutInPlaceLabel = document.getElementById('resultsTotalCollectedInPlaceLabel');
          const turnoutFromHomeLabel = document.getElementById('resultsTotalCollectedFromHomeLabel');
          if (turnoutInPlaceLabel && locale.turnoutInPlaceLabel) turnoutInPlaceLabel.textContent = locale.turnoutInPlaceLabel;
          if (turnoutFromHomeLabel && locale.turnoutFromHomeLabel) turnoutFromHomeLabel.textContent = locale.turnoutFromHomeLabel;
          const registeredControllersLabel = resultsCards.querySelector('.coverage-registered');
          const activeControllersLabel = resultsCards.querySelector('.coverage-active');
          if (registeredControllersLabel && locale.registeredControllers) registeredControllersLabel.textContent = locale.registeredControllers;
          if (activeControllersLabel && locale.activeControllers) activeControllersLabel.textContent = locale.activeControllers;
        }

        const treeTable = document.querySelector('.regions-table thead tr');
        const headerName = document.getElementById('tableHeaderName');
        const headerRegistered = document.getElementById('tableHeaderRegistered');
        const headerVoted = document.getElementById('tableHeaderVoted');
        const headerTurnout = document.getElementById('tableHeaderTurnout');
        const headerControllerActivity = document.getElementById('tableHeaderControllerActivity');
        const headerVotedInPlace = document.getElementById('tableHeaderVotedInPlace');
        const headerVotedFromHome = document.getElementById('tableHeaderVotedFromHome');
        const headerTurnoutNumber = document.getElementById('tableHeaderTurnoutNumber');
        const headerTurnoutPercent = document.getElementById('tableHeaderTurnoutPercent');
        if (headerName && locale.tableName) headerName.textContent = locale.tableName;
        if (headerRegistered && locale.tableRegistered) headerRegistered.textContent = locale.tableRegistered;
        if (headerVoted && locale.tableVoted) headerVoted.textContent = locale.tableVoted;
        if (headerTurnout && locale.tableTurnout) headerTurnout.textContent = locale.tableTurnout;
        if (headerControllerActivity && locale.tableControllerActivity) headerControllerActivity.textContent = locale.tableControllerActivity;
        if (headerVotedInPlace && locale.tableVotedInPlace) headerVotedInPlace.textContent = locale.tableVotedInPlace;
        if (headerVotedFromHome && locale.tableVotedFromHome) headerVotedFromHome.textContent = locale.tableVotedFromHome;
        if (headerTurnoutNumber && locale.tableTurnoutNumber) headerTurnoutNumber.textContent = locale.tableTurnoutNumber;
        if (headerTurnoutPercent && locale.tableTurnoutPercent) headerTurnoutPercent.textContent = locale.tableTurnoutPercent;

        const regionChartTitle = document.getElementById('regionChartTitle');
        if (regionChartTitle && locale.regionChartTitle) {
          regionChartTitle.textContent = locale.regionChartTitle;
        }

        const resultsRegionChartTitle = document.getElementById('resultsRegionChartTitle');
        if (resultsRegionChartTitle && locale.regionChartTitle) {
          resultsRegionChartTitle.textContent = locale.regionChartTitle;
        }

        const regionsSummaryTitle = document.getElementById('regionsSummaryTitle');
        if (regionsSummaryTitle && locale.regionSummaryTitle) {
          regionsSummaryTitle.textContent = locale.regionSummaryTitle;
        }

        const resultsSummaryTitle = document.getElementById('resultsSummaryTitle');
        if (resultsSummaryTitle && locale.regionSummaryTitle) {
          resultsSummaryTitle.textContent = locale.regionSummaryTitle;
        }

        const stopwatchTitle = document.getElementById('stopwatchTitle');
        if (stopwatchTitle && locale.stopwatchTitle) {
          stopwatchTitle.textContent = locale.stopwatchTitle;
        }

        const stopwatchStartBtn = document.getElementById('stopwatchStartBtn');
        if (stopwatchStartBtn && locale.startButton) {
          stopwatchStartBtn.textContent = locale.startButton;
        }

        const stopwatchStopBtn = document.getElementById('stopwatchStopBtn');
        if (stopwatchStopBtn && locale.stopButton) {
          stopwatchStopBtn.textContent = locale.stopButton;
        }

        const settingsTabs = locale.settingsTabs || {};
        const electionPhaseTabs = locale.electionPhaseTabs || {};
        const debugMainTabs = {
          inProgress: locale.debugInProgressTab || 'In Progress',
          message: locale.debugMessageTab || 'Message',
          irregularities: locale.debugIrregularitiesTab || 'Irregularities',
          database: locale.debugDatabaseTab || 'Data Base'
        };
        const debugInProgressTab = document.querySelector('[data-debug-main-tab="debug-main-tab-in-progress"]');
        const debugMessageTab = document.querySelector('[data-debug-main-tab="debug-main-tab-message"]');
        const debugDatabaseTabBtn = document.querySelector('[data-debug-main-tab="debug-main-tab-database"]');
        const debugIrregularitiesTab = document.querySelector('[data-debug-main-tab="debug-main-tab-irregularities"]');
        if (debugInProgressTab) debugInProgressTab.textContent = debugMainTabs.inProgress;
        if (debugMessageTab) debugMessageTab.textContent = debugMainTabs.message;
        if (debugDatabaseTabBtn) debugDatabaseTabBtn.textContent = debugMainTabs.database;
        if (debugIrregularitiesTab) debugIrregularitiesTab.textContent = debugMainTabs.irregularities;

        const irregularityHeaders = {
          irregularitiesDateHeader: locale.irregularitiesDate || 'Date',
          irregularitiesTimeHeader: locale.irregularitiesTime || 'Time',
          irregularitiesSenderHeader: locale.irregularitiesSender || 'Sender',
          irregularitiesPlaceHeader: locale.irregularitiesPlace || 'Voting place',
          irregularitiesExplanationHeader: locale.irregularitiesExplanation || 'Explanation',
          irregularitiesPhotoHeader: locale.irregularitiesPhoto || 'Photo'
        };
        Object.entries(irregularityHeaders).forEach(([id, text]) => {
          const element = document.getElementById(id);
          if (element) element.textContent = text;
        });

        const debugMessageFilterLabel = document.getElementById('debugMessageFilterLabel');
        if (debugMessageFilterLabel) debugMessageFilterLabel.textContent = locale.signalColumnFilterLabel || 'Filter';
        const debugMessageColumnDateLabel = document.getElementById('debugMessageColumnDateLabel');
        if (debugMessageColumnDateLabel) debugMessageColumnDateLabel.textContent = locale.signalColumnDate || locale.signalTableDate || 'Date';
        const debugMessageColumnTimeLabel = document.getElementById('debugMessageColumnTimeLabel');
        if (debugMessageColumnTimeLabel) debugMessageColumnTimeLabel.textContent = locale.signalColumnTime || locale.signalTableTime || 'Time';
        const debugMessageColumnPartyLabel = document.getElementById('debugMessageColumnPartyLabel');
        if (debugMessageColumnPartyLabel) debugMessageColumnPartyLabel.textContent = locale.signalColumnSenderTarget || locale.signalFilterParty || 'Sender/Target';
        const debugMessageColumnMessageLabel = document.getElementById('debugMessageColumnMessageLabel');
        if (debugMessageColumnMessageLabel) debugMessageColumnMessageLabel.textContent = locale.signalColumnMessage || locale.signalFilterMessageType || 'Message type';

        const debugDeleteSelectedMessagesBtn = document.getElementById('debugDeleteSelectedMessagesBtn');
        if (debugDeleteSelectedMessagesBtn) debugDeleteSelectedMessagesBtn.textContent = locale.debugDeleteSelectedMessagesBtn || 'Delete selected messages';

        const debugValidTabs = document.querySelectorAll('.debug-valid-message-tab-btn');
        if (debugValidTabs.length) {
          debugValidTabs[0].textContent = locale.signalIncomingTab || 'Incoming';
          debugValidTabs[1].textContent = locale.signalOutgoingTab || 'Outgoing';
        }
        const debugIncomingHeaders = document.querySelectorAll('#debug-valid-incoming th');
        if (debugIncomingHeaders.length >= 5) {
          debugIncomingHeaders[1].textContent = locale.signalTableDate || 'Date';
          debugIncomingHeaders[2].textContent = locale.signalTableTime || 'Time';
          debugIncomingHeaders[3].textContent = locale.signalTableSender || 'Sender';
          debugIncomingHeaders[4].textContent = locale.signalTableMessage || 'Message';
        }
        const debugOutgoingHeaders = document.querySelectorAll('#debug-valid-outgoing th');
        if (debugOutgoingHeaders.length >= 5) {
          debugOutgoingHeaders[1].textContent = locale.signalTableDate || 'Date';
          debugOutgoingHeaders[2].textContent = locale.signalTableTime || 'Time';
          debugOutgoingHeaders[3].textContent = locale.signalTableTarget || 'Target';
          debugOutgoingHeaders[4].textContent = locale.signalTableMessage || 'Message';
        }

        const debugRawWhenHeader = document.getElementById('debugRawDateHeader');
        if (debugRawWhenHeader) debugRawWhenHeader.textContent = locale.debugRawDateHeader || 'Date';
        const debugRawTimeHeader = document.getElementById('debugRawTimeHeader');
        if (debugRawTimeHeader) debugRawTimeHeader.textContent = locale.debugRawTimeHeader || 'Time';
        const debugRawDirectionHeader = document.getElementById('debugRawDirectionHeader');
        if (debugRawDirectionHeader) debugRawDirectionHeader.textContent = locale.debugRawDirectionHeader || 'Direction';
        const debugRawPayloadHeader = document.getElementById('debugRawPayloadHeader');
        if (debugRawPayloadHeader) debugRawPayloadHeader.textContent = locale.debugRawPayloadHeader || 'Raw payload';

        // Data Base tab labels
        const dbClearDataBtn = document.getElementById('dbClearDataBtn');
        if (dbClearDataBtn) dbClearDataBtn.textContent = locale.dbClearDataBtn || 'Clear Data';
        const dbClearRawMessagesLabel = document.getElementById('dbClearRawMessagesLabel');
        if (dbClearRawMessagesLabel) dbClearRawMessagesLabel.textContent = locale.dbClearRawMessagesLabel || 'Delete All Raw Messages';
        const dbClearAllLabel = document.getElementById('dbClearAllLabel');
        if (dbClearAllLabel) dbClearAllLabel.textContent = locale.signalFilterAll || 'ALL';
        const dbClearSenderLabel = document.getElementById('dbClearSenderLabel');
        if (dbClearSenderLabel) dbClearSenderLabel.textContent = locale.dbClearSender || 'Clear Sender';
        const dbClearStatusLabel = document.getElementById('dbClearStatusLabel');
        if (dbClearStatusLabel) dbClearStatusLabel.textContent = locale.dbClearStatus || 'Clear Status';
        const dbClearTurnoutLabel = document.getElementById('dbClearTurnoutLabel');
        if (dbClearTurnoutLabel) dbClearTurnoutLabel.textContent = locale.dbClearTurnout || 'Clear TurnoutVotes';
        const dbClearResultsLabel = document.getElementById('dbClearResultsLabel');
        if (dbClearResultsLabel) dbClearResultsLabel.textContent = locale.dbClearResults || 'Clear Results';
        const dbClearCorrectionLabel = document.getElementById('dbClearCorrectionLabel');
        if (dbClearCorrectionLabel) dbClearCorrectionLabel.textContent = locale.dbClearCorrection || 'Clear Correction';
        const dbClearIrregularitiesLabel = document.getElementById('dbClearIrregularitiesLabel');
        if (dbClearIrregularitiesLabel) dbClearIrregularitiesLabel.textContent = locale.dbClearIrregularities || 'Delete All Irregularities';
        const dbClearZapRecordsLabel = document.getElementById('dbClearZapRecordsLabel');
        if (dbClearZapRecordsLabel) dbClearZapRecordsLabel.textContent = locale.dbClearZapRecords || 'Delete All Polling Station Records';

        const settingsStopwatchTab = document.querySelector('[data-settings-tab="settings-tab-stopwatch"]');
        if (settingsStopwatchTab) {
          settingsStopwatchTab.textContent = settingsTabs.stopwatch || locale.stopwatchTitle || 'Stopwatch';
        }

        const settingsElectionPhaseTab = document.querySelector('[data-settings-tab="settings-tab-election-phase"]');
        if (settingsElectionPhaseTab) {
          settingsElectionPhaseTab.textContent = settingsTabs.electionPhase || 'Election Phase';
        }

        const settingsSignalTab = document.querySelector('[data-settings-tab="settings-tab-signal"]');
        if (settingsSignalTab) {
          settingsSignalTab.textContent = settingsTabs.signal || 'Signal';
        }

        const signalDescription = document.getElementById('signalDescription');
        if (signalDescription) {
          signalDescription.textContent = locale.signalDescription || 'Connects to Signal App group responsible for collecting election results and different statuses';
        }

        const signalGroupLabel = document.getElementById('signalGroupLabel');
        if (signalGroupLabel) {
          signalGroupLabel.textContent = locale.signalGroupLabel || 'Signal group';
        }
        const signalColumnFilterLabel = document.getElementById('signalColumnFilterLabel');
        if (signalColumnFilterLabel) {
          signalColumnFilterLabel.textContent = locale.signalColumnFilterLabel || 'Filter';
        }
        const signalColumnDateLabel = document.getElementById('signalColumnDateLabel');
        if (signalColumnDateLabel) {
          signalColumnDateLabel.textContent = locale.signalColumnDate || locale.signalTableDate || 'Date';
        }
        const signalColumnTimeLabel = document.getElementById('signalColumnTimeLabel');
        if (signalColumnTimeLabel) {
          signalColumnTimeLabel.textContent = locale.signalColumnTime || locale.signalTableTime || 'Time';
        }
        const signalColumnPartyLabel = document.getElementById('signalColumnPartyLabel');
        if (signalColumnPartyLabel) {
          signalColumnPartyLabel.textContent = locale.signalColumnSenderTarget || locale.signalFilterParty || 'Sender/Target';
        }
        const signalColumnMessageLabel = document.getElementById('signalColumnMessageLabel');
        if (signalColumnMessageLabel) {
          signalColumnMessageLabel.textContent = locale.signalColumnMessage || locale.signalFilterMessageType || 'Message type';
        }

        const signalTabs = document.querySelectorAll('.signal-message-tab-btn');
        if (signalTabs.length) {
          signalTabs[0].textContent = locale.signalIncomingTab || 'Incoming';
          signalTabs[1].textContent = locale.signalOutgoingTab || 'Outgoing';
        }

        if (typeof refreshSignalMessageTables === 'function') {
          refreshSignalMessageTables();
        }

        const incomingHeaders = document.querySelectorAll('#signal-incoming-messages th');
        if (incomingHeaders.length >= 4) {
          incomingHeaders[0].textContent = locale.signalTableDate || 'Date';
          incomingHeaders[1].textContent = locale.signalTableTime || 'Time';
          incomingHeaders[2].textContent = locale.signalTableSender || 'Sender';
          incomingHeaders[3].textContent = locale.signalTableMessage || 'Message';
        }

        const outgoingHeaders = document.querySelectorAll('#signal-outgoing-messages th');
        if (outgoingHeaders.length >= 4) {
          outgoingHeaders[0].textContent = locale.signalTableDate || 'Date';
          outgoingHeaders[1].textContent = locale.signalTableTime || 'Time';
          outgoingHeaders[2].textContent = locale.signalTableTarget || 'Target';
          outgoingHeaders[3].textContent = locale.signalTableMessage || 'Message';
        }

        const signalGroupPlaceholder = locale.signalGroupPlaceholder || '-- Select group --';
        const signalGroupSelect = document.getElementById('signalGroupSelect');
        if (signalGroupSelect) {
          const currentValue = signalGroupSelect.value;
          Array.from(signalGroupSelect.options).forEach((option) => {
            if (!option.value && option.textContent === '-- Select group --') {
              option.textContent = signalGroupPlaceholder;
            }
            if (!option.value && option.textContent === 'No Signal groups detected') {
              option.textContent = signalGroupPlaceholder;
            }
          });
          if (!currentValue && signalGroupSelect.options.length) {
            signalGroupSelect.options[0].textContent = signalGroupPlaceholder;
          }
        }

        const stopwatchExplanation = document.getElementById('stopwatchExplanation');
        if (stopwatchExplanation) {
          stopwatchExplanation.textContent = locale.stopwatchDescription || 'Start and measure the duration of the election phase';
        }

        const underConstructionText = locale.underConstruction || 'Under Construction';
        const turnoutConstructionOverlay = document.getElementById('turnoutConstructionOverlay');
        if (turnoutConstructionOverlay) turnoutConstructionOverlay.textContent = underConstructionText;
        const resultsConstructionOverlay = document.getElementById('resultsConstructionOverlay');
        if (resultsConstructionOverlay) resultsConstructionOverlay.textContent = underConstructionText;

        const parliamentaryOnlyNotice = document.getElementById('parliamentaryOnlyNotice');
        if (parliamentaryOnlyNotice) {
          parliamentaryOnlyNotice.textContent = locale.parliamentaryOnlyNotice || 'This view is currently available only for parliamentary elections.';
        }

        const stopwatchStatus = document.getElementById('stopwatchStatus');
        if (stopwatchStatus) {
          const statusLabel = stopwatchRunning ? (locale.stopwatchRunning || 'Running') : (locale.stopwatchStopped || 'Stopped');
          const durationLabel = locale.stopwatchDurationLabel || 'Duration';
          stopwatchStatus.textContent = `${statusLabel} · ${durationLabel}: ${formatStopwatch(stopwatchElapsedMs)}`;
        }

        const electionPhaseButtons = document.querySelectorAll('.election-phase-tab-btn');
        const electionPhaseButtonMap = {
          'election-phase-tab-parliamentary': electionPhaseTabs.parliamentaryElections || 'Parliamentary elections',
          'election-phase-tab-presidental': electionPhaseTabs.presidentalElection || 'Presidential election',
          'election-phase-tab-local': electionPhaseTabs.localElections || 'Local elections'
        };
        electionPhaseButtons.forEach((button) => {
          const label = electionPhaseButtonMap[button.dataset.electionPhaseTab];
          if (label) button.textContent = label;
        });

        const electionPhaseTitle = document.getElementById('stopwatchExplanation');
        if (electionPhaseTitle && locale.stopwatchDescription) {
          electionPhaseTitle.textContent = locale.stopwatchDescription;
        }

        const parliamentaryPhaseSelector = locale.parliamentaryPhaseSelector || {};
        const parliamentaryPhaseLabel = document.getElementById('parliamentaryPhaseLabel');
        if (parliamentaryPhaseLabel) {
          parliamentaryPhaseLabel.textContent = parliamentaryPhaseSelector.label || 'Select parliamentary election phase';
        }

        const phaseLabels = {
          parliamentaryPhasePreparationLabel: parliamentaryPhaseSelector.preparationPhase || 'Preparation',
          parliamentaryPhaseElectionDayLabel: parliamentaryPhaseSelector.electionDay || 'Election Day',
          parliamentaryPhaseRepeatedLabel: parliamentaryPhaseSelector.repeatedElections || 'Repeated Election'
        };
        Object.entries(phaseLabels).forEach(([id, value]) => {
          const el = document.getElementById(id);
          if (el) el.textContent = value;
        });

        const checked = document.querySelector(`input[data-parliamentary-phase="${activeParliamentaryPhase}"]`);
        document.querySelectorAll('input[data-parliamentary-phase]').forEach((input) => {
          input.checked = input === checked;
        });

        const presidentialPhaseSelector = locale.presidentalPhaseSelector || {};
        const presidentialPhaseLabel = document.getElementById('presidentalPhaseLabel');
        if (presidentialPhaseLabel) {
          presidentialPhaseLabel.textContent = presidentialPhaseSelector.label || 'Select presidential election phase';
        }
        const presidentialPhaseLabels = {
          presidentalPhasePreparationLabel: presidentialPhaseSelector.preparation || 'Preparation',
          presidentalPhaseFirstRoundElectionDayLabel: presidentialPhaseSelector.firstRoundElectionDay || 'First round - election day',
          presidentalPhaseFirstRoundRepeatedLabel: presidentialPhaseSelector.firstroundRepededElections || 'First round - repeated elections',
          presidentalPhaseSecondRoundElectionDayLabel: presidentialPhaseSelector.secondRoudelectionDay || 'Second round - election day',
          presidentalPhaseSecondRoundRepeatedLabel: presidentialPhaseSelector.secondRoundRepeetadelections || 'Second round - repeated elections'
        };
        Object.entries(presidentialPhaseLabels).forEach(([id, value]) => {
          const el = document.getElementById(id);
          if (el) el.textContent = value;
        });
        const presidentialChecked = document.querySelector(`input[data-presidental-phase="${activePresidentialPhase}"]`);
        document.querySelectorAll('input[data-presidental-phase]').forEach((input) => {
          input.checked = input === presidentialChecked;
        });

        const localPhaseSelector = locale.localPhaseSelector || {};
        const localPhaseLabel = document.getElementById('localPhaseLabel');
        if (localPhaseLabel) {
          localPhaseLabel.textContent = localPhaseSelector.label || 'Select local election phase';
        }
        const localPhaseLabels = {
          localPhasePreparationLabel: localPhaseSelector.preparationPhase || 'Preparation',
          localPhaseElectionDayLabel: localPhaseSelector.electionDay || 'Election Day',
          localPhaseRepeatedLabel: localPhaseSelector.repeatedElections || 'Repeated Election'
        };
        Object.entries(localPhaseLabels).forEach(([id, value]) => {
          const el = document.getElementById(id);
          if (el) el.textContent = value;
        });
        const localChecked = document.querySelector(`input[data-local-phase="${activeLocalPhase}"]`);
        document.querySelectorAll('input[data-local-phase]').forEach((input) => {
          input.checked = input === localChecked;
        });

        updateParliamentaryViewVisibility();
        updateBannerTitle();
        renderCoverageStatusPanel();
      }

      function getNavigationItems(config) {
        const languageConfig = getLanguageConfig(config);
        const raw = languageConfig.navigation || config && (config.navigation || config.menu || config.nav || config.sidebarMenu || config.controls);
        if (Array.isArray(raw) && raw.length) {
          return raw.map((item) => ({
            id: item.id || item.panel || item.key || item.name || 'item',
            label: item.label || item.name || item.title || item.text || item.id || 'Item'
          }));
        }
        return [
          { id: 'izlaznost', label: 'Izlaznost' },
          { id: 'rezultati', label: 'Izborni rezultati' },
          { id: 'irregularities', label: 'Irregularities' },
          { id: 'debug', label: 'Alati' },
          { id: 'language', label: 'Jezik' }
        ];
      }

      function renderSidebarLanguageSelector(config) {
        const panel = document.getElementById('sidebarLanguagePanel');
        const select = document.getElementById('sidebarLanguageSelect');
        const label = document.getElementById('sidebarLanguageLabel');
        if (!panel || !select || !label) return;

        const multi = config && config.multiLanguage && typeof config.multiLanguage === 'object' ? config.multiLanguage : {};
        const languages = Object.keys(multi).length ? Object.keys(multi) : ['sr', 'en'];
        const current = activeLanguage && multi[activeLanguage] ? activeLanguage : ((config && config.defaultLanguage) || 'sr');
        const languageConfig = multi[current] || multi[languages[0]] || {};
        const selectorConfig = (languageConfig.languageSelector) || { label: 'Language', options: { sr: 'Srpski', en: 'English' } };

        label.textContent = selectorConfig.label || 'Language';
        panel.style.display = languages.length > 1 ? 'flex' : 'none';
        select.innerHTML = '';

        languages.forEach((lang) => {
          const option = document.createElement('option');
          option.value = lang;
          const optionsMap = (multi[lang] && multi[lang].languageSelector && multi[lang].languageSelector.options) || selectorConfig.options || { sr: 'Srpski', en: 'English' };
          option.textContent = optionsMap[lang] || (lang === 'sr' ? 'Srpski' : 'English');
          option.selected = lang === current;
          select.appendChild(option);
        });

        select.value = current;
        select.onchange = (event) => {
          activeLanguage = event.target.value;
          renderSidebarLanguageSelector(cachedConfig);
          buildSidebarMenu(cachedConfig);
          applyConfigHeader(cachedConfig);
          setupDebugTabs();
          refreshLocalizedStaticLabels();
          buildRegionCards(cachedConfig);
          buildRegionsTree(cachedConfig);
          buildResultsCards(cachedConfig);
          buildResultsTree(cachedConfig);
          buildIrregularitiesTree(cachedConfig);
          buildZapTree(cachedConfig);
          setZapLabels();
          if (cachedConfig) {
            const totals = buildConfigTotals(cachedConfig);
            const totalRegistered = Object.values(totals.placeTotals || {}).reduce((sum, item) => sum + Number(item || 0), 0);
            const totalCollected = totals.totalCollected || 0;
            const totalPctEl = document.getElementById('totalPercent');
            if (totalPctEl) {
              const pct = totalRegistered > 0 ? (Number(totalCollected) / Number(totalRegistered)) * 100 : 0;
              totalPctEl.textContent = `${pct.toFixed(2)}%`;
            }
          }
        };
      }

      function buildSidebarMenu(config) {
        const nav = document.getElementById('sidebarMenu');
        if (!nav) return;

        nav.innerHTML = '';
        const items = getNavigationItems(config);
        items.forEach((item, index) => {
          if (item.id === 'language') return;

          const button = document.createElement('button');
          button.type = 'button';
          button.className = `menu-item${index === 0 ? ' active' : ''}`;
          button.dataset.panel = item.id;
          button.textContent = item.label;
          button.addEventListener('click', () => {
            if (button.disabled) return;
            document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b === button));
            const panel = button.dataset.panel;
            document.getElementById('pageTitle').textContent = button.textContent;
            setIrregularitiesActionsVisibility(panel);
            document.querySelectorAll('.panel').forEach((p) => {
              const toShow = p.id === 'panel-' + panel;
              p.style.display = toShow ? '' : 'none';
              p.classList.toggle('active-panel', toShow);
            });
          });
          nav.appendChild(button);
        });

        const active = nav.querySelector('.menu-item.active');
        const pageTitle = document.getElementById('pageTitle');
        if (active && pageTitle) pageTitle.textContent = active.textContent;
        updateSidebarNavigationState();
      }

      function setupLanguageSelector(config) {
        const selector = document.getElementById('languageSelector');
        const label = document.getElementById('languageSelectorLabel');
        if (!selector || !config || !config.multiLanguage || !Object.keys(config.multiLanguage).length) return;

        const languages = Object.keys(config.multiLanguage);
        const current = activeLanguage && config.multiLanguage[activeLanguage] ? activeLanguage : (config.defaultLanguage || languages[0]);
        const langConfig = config.multiLanguage[current] || config.multiLanguage[languages[0]];
        const selectorConfig = (langConfig && langConfig.languageSelector) || { label: 'Language', options: { sr: 'Srpski', en: 'English' } };

        if (label) label.textContent = selectorConfig.label || 'Language';
        selector.innerHTML = '';
        languages.forEach((lang) => {
          const option = document.createElement('option');
          option.value = lang;
          const optionsMap = (langConfig && langConfig.languageSelector && langConfig.languageSelector.options) || selectorConfig.options || {};
          option.textContent = optionsMap[lang] || (lang === 'sr' ? 'Srpski' : 'English');
          option.selected = lang === current;
          selector.appendChild(option);
        });

        selector.value = current;
        activeLanguage = current;
        selector.onchange = (event) => {
          activeLanguage = event.target.value;
          const nextLangConfig = config.multiLanguage[activeLanguage] || config.multiLanguage[languages[0]];
          const nextSelectorConfig = (nextLangConfig && nextLangConfig.languageSelector) || { label: 'Language', options: { sr: 'Srpski', en: 'English' } };
          if (label) label.textContent = nextSelectorConfig.label || 'Language';
          buildSidebarMenu(cachedConfig);
          applyConfigHeader(cachedConfig);
          setupDebugTabs();
        };
      }

      function syncSidebarState() {
        if (!sidebar) return;
        const expanded = sidebarPinned || sidebarHovered;
        sidebar.classList.toggle('collapsed', !expanded);
        sidebar.style.width = expanded ? `${sidebarWidth}px` : `${SIDEBAR_COLLAPSED}px`;
        sidebar.style.minWidth = expanded ? `${sidebarWidth}px` : `${SIDEBAR_COLLAPSED}px`;
        sidebar.style.maxWidth = '420px';
        if (sidebarPin) {
          sidebarPin.classList.toggle('pinned', sidebarPinned);
          sidebarPin.classList.toggle('unpinned', !sidebarPinned);
          sidebarPin.title = sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar';
          sidebarPin.setAttribute('aria-label', sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar');
          sidebarPin.textContent = '📌';
        }
      }

      function updateSidebarHoverState(clientX) {
        if (!sidebar || sidebarPinned) return;
        const rect = sidebar.getBoundingClientRect();
        const nearEdge = clientX <= rect.left + 26;
        const inside = clientX >= rect.left && clientX <= rect.right;
        sidebarHovered = nearEdge || inside;
        syncSidebarState();
      }

      sidebarPin?.addEventListener('click', (event) => {
        sidebarPinned = !sidebarPinned;
        if (sidebarPinned) {
          sidebarHovered = true;
        } else {
          sidebarHovered = false;
        }
        syncSidebarState();
        event.stopPropagation();
      });

      sidebar?.addEventListener('mouseenter', () => {
        if (!sidebarPinned) {
          sidebarHovered = true;
          syncSidebarState();
        }
      });

      sidebar?.addEventListener('mouseleave', () => {
        if (!sidebarPinned) {
          sidebarHovered = false;
          syncSidebarState();
        }
      });

      const hoverTooltip = document.createElement('div');
      hoverTooltip.className = 'hover-tooltip';
      document.body.appendChild(hoverTooltip);
      let hoverTooltipTarget = null;

      function hideHoverTooltip() {
        hoverTooltipTarget = null;
        hoverTooltip.classList.remove('visible');
      }

      function positionHoverTooltip(event) {
        const offset = 14;
        hoverTooltip.style.left = `${event.clientX + offset}px`;
        hoverTooltip.style.top = `${event.clientY + offset}px`;
      }

      function attachTooltipDelegation(container) {
        if (!container) return;
        container.addEventListener('pointerover', (event) => {
          const target = event.target.closest('[data-tooltip]');
          if (!target) return;
          hoverTooltipTarget = target;
          hoverTooltip.textContent = target.dataset.tooltip;
          positionHoverTooltip(event);
          hoverTooltip.classList.add('visible');
        });
        container.addEventListener('pointermove', (event) => {
          if (hoverTooltipTarget) positionHoverTooltip(event);
        });
        container.addEventListener('pointerout', (event) => {
          if (hoverTooltipTarget && event.target.closest('[data-tooltip]') === hoverTooltipTarget) {
            hideHoverTooltip();
          }
        });
      }

      attachTooltipDelegation(document.getElementById('resultsTree'));
      attachTooltipDelegation(document.getElementById('resultsRegionChart'));
      document.addEventListener('scroll', hideHoverTooltip, true);

      document.addEventListener('pointermove', (event) => {
        if (resizingSidebar && appGrid) {
          const gridRect = appGrid.getBoundingClientRect();
          const nextWidth = Math.min(Math.max(event.clientX - gridRect.left, SIDEBAR_MIN), 420);
          sidebarWidth = nextWidth;
          if (sidebarPinned || sidebarHovered) {
            syncSidebarState();
          }
          return;
        }
        if (!sidebarPinned) {
          updateSidebarHoverState(event.clientX);
        }
      });

      document.addEventListener('pointerleave', () => {
        if (!sidebarPinned) {
          sidebarHovered = false;
          syncSidebarState();
        }
      });

      sidebarResizeHandle?.addEventListener('pointerdown', (event) => {
        resizingSidebar = true;
        event.preventDefault();
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('pointerup', () => {
        resizingSidebar = false;
        document.body.style.userSelect = '';
      });

      syncSidebarState();

      function setupDebugTabs() {
        const buttons = document.querySelectorAll('.debug-tab-btn');
        const panels = document.querySelectorAll('.debug-tab-panel');
        const debugTabs = getLanguageConfig(cachedConfig || {}, activeLanguage).debugTabs || { main: 'Debug', settings: 'Podesavanja' };

        const mainTab = document.querySelector('[data-debug-tab="debug-tab-main"]');
        const settingsTab = document.querySelector('[data-debug-tab="debug-tab-settings"]');
        if (mainTab) mainTab.textContent = debugTabs.main || 'Debug';
        if (settingsTab) settingsTab.textContent = debugTabs.settings || 'Podesavanja';

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.dataset.debugTab;
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel) return;

            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });

            panels.forEach((panel) => {
              const isActive = panel.id === targetId;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });

        setupDebugMainTabs();
        setupSettingsTabs();
        setupTurnoutTabs();
        setupResultsTabs();
      }

      function setupDebugMainTabs() {
        const buttons = document.querySelectorAll('.debug-main-tab-btn');
        const panels = document.querySelectorAll('.debug-main-tab-panel');
        const locale = getLocaleDictionary();

        const inProgressTab = document.querySelector('[data-debug-main-tab="debug-main-tab-in-progress"]');
        const messageTab = document.querySelector('[data-debug-main-tab="debug-main-tab-message"]');
        const databaseTab = document.querySelector('[data-debug-main-tab="debug-main-tab-database"]');
        if (inProgressTab) inProgressTab.textContent = locale.debugInProgressTab || 'In Progress';
        if (messageTab) messageTab.textContent = locale.debugMessageTab || 'Message';
        if (databaseTab) databaseTab.textContent = locale.debugDatabaseTab || 'Data Base';

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.dataset.debugMainTab;
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel) return;

            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });

            panels.forEach((panel) => {
              const isActive = panel.id === targetId;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });
        setupDebugValidMessageTabs();
      }

      function setupDebugValidMessageTabs() {
        const buttons = document.querySelectorAll('.debug-valid-message-tab-btn');
        const panels = document.querySelectorAll('.debug-valid-message-tab-panel');
        const locale = getLocaleDictionary();

        if (buttons[0]) buttons[0].textContent = locale.signalIncomingTab || 'Incoming';
        if (buttons[1]) buttons[1].textContent = locale.signalOutgoingTab || 'Outgoing';

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.dataset.debugValidTab;
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel) return;

            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });

            panels.forEach((panel) => {
              const isActive = panel.id === targetId;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });
      }

      function setupTurnoutTabs() {
        const buttons = document.querySelectorAll('.turnout-tab-btn');
        const panels = document.querySelectorAll('.turnout-tab-panel');
        const turnoutTabs = getLocaleDictionary().turnoutTabs || {};
        const labels = {
          'turnout-tab-per-region': turnoutTabs.perRegion || 'Turnout per Region',
          'turnout-tab-coverage': turnoutTabs.coverage || 'Coverage'
        };

        buttons.forEach((button) => {
          const label = labels[button.dataset.turnoutTab];
          if (label) button.textContent = label;
          button.addEventListener('click', () => {
            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });
            panels.forEach((panel) => {
              const isActive = panel.id === button.dataset.turnoutTab;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });
      }

      function setupResultsTabs() {
        const buttons = document.querySelectorAll('.results-tab-btn');
        const panels = document.querySelectorAll('.results-tab-panel');
        const resultsTabs = getLocaleDictionary().resultsTabs || {};
        const labels = {
          'results-tab-per-region': resultsTabs.perRegion || 'Results per Region',
          'results-tab-coverage': resultsTabs.coverage || 'Coverage'
        };

        buttons.forEach((button) => {
          const label = labels[button.dataset.resultsTab];
          if (label) button.textContent = label;
          button.addEventListener('click', () => {
            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });
            panels.forEach((panel) => {
              const isActive = panel.id === button.dataset.resultsTab;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });
      }

      function setupSettingsTabs() {
        const buttons = document.querySelectorAll('.settings-tab-btn');
        const panels = document.querySelectorAll('.settings-tab-panel');
        const settingsTabs = getLocaleDictionary().settingsTabs || {};

        const stopwatchTab = document.querySelector('[data-settings-tab="settings-tab-stopwatch"]');
        const electionPhaseTab = document.querySelector('[data-settings-tab="settings-tab-election-phase"]');
        const signalTab = document.querySelector('[data-settings-tab="settings-tab-signal"]');
        if (stopwatchTab) stopwatchTab.textContent = settingsTabs.stopwatch || 'Stopwatch';
        if (electionPhaseTab) electionPhaseTab.textContent = settingsTabs.electionPhase || 'Election Phase';
        if (signalTab) signalTab.textContent = settingsTabs.signal || 'Signal';

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.dataset.settingsTab;
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel) return;

            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });

            panels.forEach((panel) => {
              const isActive = panel.id === targetId;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });

        setupElectionPhaseTabs();
      }

      function setupElectionPhaseTabs() {
        const buttons = document.querySelectorAll('.election-phase-tab-btn');
        const panels = document.querySelectorAll('.election-phase-tab-panel');
        const electionPhaseTabs = getLocaleDictionary().electionPhaseTabs || {};
        const labels = {
          'election-phase-tab-parliamentary': electionPhaseTabs.parliamentaryElections || 'Parliamentary elections',
          'election-phase-tab-presidental': electionPhaseTabs.presidentalElection || 'Presidential election',
          'election-phase-tab-local': electionPhaseTabs.localElections || 'Local elections'
        };

        buttons.forEach((button) => {
          const label = labels[button.dataset.electionPhaseTab];
          if (label) button.textContent = label;
          button.addEventListener('click', () => {
            activateElectionPhaseTab(button.dataset.electionPhaseTab);
          });
        });

        activateElectionPhaseTab('election-phase-tab-parliamentary');

        const selectorButtons = document.querySelectorAll('input[data-parliamentary-phase]');
        const selectorLabels = getLocaleDictionary().parliamentaryPhaseSelector || {};
        const labelMap = {
          preparationPhase: selectorLabels.preparationPhase || 'Preparation',
          electionDay: selectorLabels.electionDay || 'Election Day',
          repeatedElections: selectorLabels.repeatedElections || 'Repeated Election'
        };
        selectorButtons.forEach((input) => {
          const labelIdMap = {
            preparationPhase: 'parliamentaryPhasePreparationLabel',
            electionDay: 'parliamentaryPhaseElectionDayLabel',
            repeatedElections: 'parliamentaryPhaseRepeatedLabel'
          };
          const labelEl = document.getElementById(labelIdMap[input.dataset.parliamentaryPhase]);
          if (labelEl) labelEl.textContent = labelMap[input.dataset.parliamentaryPhase] || labelEl.textContent;
          input.addEventListener('change', () => {
            if (!input.checked) {
              clearElectionPhaseSelection('parliamentary');
              return;
            }
            activeParliamentaryPhase = input.dataset.parliamentaryPhase;
            activeElectionFamily = 'parliamentary';
            activePresidentialPhase = null;
            document.querySelectorAll('input[data-presidental-phase]').forEach((presInput) => {
              presInput.checked = false;
            });
            document.querySelectorAll('input[data-parliamentary-phase]').forEach((parInput) => {
              parInput.checked = parInput === input;
            });
            updateParliamentaryViewVisibility();
            updateBannerTitle();
          });
        });

        const presidentialSelectorButtons = document.querySelectorAll('input[data-presidental-phase]');
        const presidentialSelectorLabels = getLocaleDictionary().presidentalPhaseSelector || {};
        const presidentialLabelMap = {
          preparation: presidentialSelectorLabels.preparation || 'Preparation',
          firstRoundElectionDay: presidentialSelectorLabels.firstRoundElectionDay || 'First round - election day',
          firstroundRepededElections: presidentialSelectorLabels.firstroundRepededElections || 'First round - repeated elections',
          secondRoudelectionDay: presidentialSelectorLabels.secondRoudelectionDay || 'Second round - election day',
          secondRoundRepeetadelections: presidentialSelectorLabels.secondRoundRepeetadelections || 'Second round - repeated elections'
        };
        presidentialSelectorButtons.forEach((input) => {
          const labelIdMap = {
            preparation: 'presidentalPhasePreparationLabel',
            firstRoundElectionDay: 'presidentalPhaseFirstRoundElectionDayLabel',
            firstroundRepededElections: 'presidentalPhaseFirstRoundRepeatedLabel',
            secondRoudelectionDay: 'presidentalPhaseSecondRoundElectionDayLabel',
            secondRoundRepeetadelections: 'presidentalPhaseSecondRoundRepeatedLabel'
          };
          const labelEl = document.getElementById(labelIdMap[input.dataset.presidentalPhase]);
          if (labelEl) labelEl.textContent = presidentialLabelMap[input.dataset.presidentalPhase] || labelEl.textContent;
          input.addEventListener('change', () => {
            if (!input.checked) {
              clearElectionPhaseSelection('presidental');
              return;
            }
            activePresidentialPhase = input.dataset.presidentalPhase;
            activeElectionFamily = 'presidental';
            activeParliamentaryPhase = null;
            document.querySelectorAll('input[data-parliamentary-phase]').forEach((parInput) => {
              parInput.checked = false;
            });
            document.querySelectorAll('input[data-presidental-phase]').forEach((presInput) => {
              presInput.checked = presInput === input;
            });
            updateParliamentaryViewVisibility();
            updateBannerTitle();
          });
        });

        const localSelectorButtons = document.querySelectorAll('input[data-local-phase]');
        const localSelectorLabels = getLocaleDictionary().localPhaseSelector || {};
        const localLabelMap = {
          preparationPhase: localSelectorLabels.preparationPhase || 'Preparation',
          electionDay: localSelectorLabels.electionDay || 'Election Day',
          repeatedElections: localSelectorLabels.repeatedElections || 'Repeated Election'
        };
        localSelectorButtons.forEach((input) => {
          const labelIdMap = {
            preparationPhase: 'localPhasePreparationLabel',
            electionDay: 'localPhaseElectionDayLabel',
            repeatedElections: 'localPhaseRepeatedLabel'
          };
          const labelEl = document.getElementById(labelIdMap[input.dataset.localPhase]);
          if (labelEl) labelEl.textContent = localLabelMap[input.dataset.localPhase] || labelEl.textContent;
          input.addEventListener('change', () => {
            if (!input.checked) {
              clearElectionPhaseSelection('local');
              return;
            }
            activeLocalPhase = input.dataset.localPhase;
            activeElectionFamily = 'local';
            activeParliamentaryPhase = null;
            activePresidentialPhase = null;
            document.querySelectorAll('input[data-parliamentary-phase]').forEach((parInput) => {
              parInput.checked = false;
            });
            document.querySelectorAll('input[data-presidental-phase]').forEach((presInput) => {
              presInput.checked = false;
            });
            document.querySelectorAll('input[data-local-phase]').forEach((localInput) => {
              localInput.checked = localInput === input;
            });
            updateParliamentaryViewVisibility();
            updateBannerTitle();
          });
        });

      }

      function activateElectionPhaseTab(targetId) {
        const buttons = document.querySelectorAll('.election-phase-tab-btn');
        const panels = document.querySelectorAll('.election-phase-tab-panel');
        const targetPanel = document.getElementById(targetId);
        if (!targetPanel) return;

        if (targetId === 'election-phase-tab-parliamentary') {
          activeElectionFamily = 'parliamentary';
        } else if (targetId === 'election-phase-tab-presidental') {
          activeElectionFamily = 'presidental';
        } else if (targetId === 'election-phase-tab-local') {
          activeElectionFamily = 'local';
        }

        buttons.forEach((btn) => {
          const isActive = btn.dataset.electionPhaseTab === targetId;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });

        panels.forEach((panel) => {
          const isActive = panel.id === targetId;
          panel.classList.toggle('active', isActive);
          panel.style.display = isActive ? 'block' : 'none';
        });

        updateParliamentaryViewVisibility();
        updateBannerTitle();
        renderCoverageStatusPanel();
      }

      function formatDashboardLabel(value) {
        const safe = String(value || 'Dashboard');
        return safe.replace(/©/g, '<span class="copyright-mark">©</span>');
      }

      function applyConfigHeader(config) {
        const languageConfig = getLanguageConfig(config, activeLanguage);
        const bannerEyebrow = document.querySelector('.page-banner .eyebrow');
        if (bannerEyebrow) bannerEyebrow.innerHTML = formatDashboardLabel((languageConfig.dashboard || config && (config.dashboard || config.Dashboard)) || 'Dashboard');
        const logo = document.querySelector('.logo');
        if (logo) logo.textContent = 'Dashboard';
        const collapsedLabel = document.querySelector('.sidebar-collapsed-label');
        if (collapsedLabel) collapsedLabel.textContent = 'Dashboard';
        refreshLocalizedStaticLabels();
      }

      function updateBannerTitle() {
        const locale = getLocaleDictionary();
        const localBaseTitle = locale.localTitle || 'Local Elections 2026';
        const presidentialBaseTitle = locale.presidentalTitle || 'Presidential Elections 2026';
        const parliamentaryTitles = locale.parliamentaryPhaseTitles || {};
        const localTitles = locale.localPhaseTitles || {};
        const parliamentaryTitle = parliamentaryTitles[activeParliamentaryPhase];
        const presidentialTitles = locale.presidentalPhaseTitles || {};
        const presidentialSuffix = presidentialTitles[activePresidentialPhase];
        const localSuffix = localTitles[activeLocalPhase];
        const title = activeElectionFamily === 'parliamentary'
          ? (parliamentaryTitle || (locale.noElectionSelected || 'No election is selected'))
          : activeElectionFamily === 'presidental'
            ? (presidentialSuffix ? `${presidentialBaseTitle} - ${presidentialSuffix}` : (locale.noElectionSelected || 'No election is selected'))
            : activeElectionFamily === 'local'
              ? (localSuffix ? `${localBaseTitle} - ${localSuffix}` : (locale.noElectionSelected || 'No election is selected'))
            : (locale.noElectionSelected || 'No election is selected');
        const banner = document.getElementById('pageBannerTitle');
        if (banner) banner.textContent = title;
        document.title = title;
      }

      function updateParliamentaryViewVisibility() {
        const locale = getLocaleDictionary();
        const notice = document.getElementById('parliamentaryOnlyNotice');
        const hasElectionSelection = Boolean(activeParliamentaryPhase || activePresidentialPhase || activeLocalPhase);
        const showParliamentary = activeElectionFamily === 'parliamentary' && Boolean(activeParliamentaryPhase);
        const showConstruction = hasElectionSelection && activeElectionFamily !== 'parliamentary';
        if (notice) {
          notice.textContent = locale.parliamentaryOnlyNotice || 'This view is currently available only for parliamentary elections.';
          notice.style.display = hasElectionSelection ? 'none' : 'block';
        }

        const turnoutPanel = document.getElementById('panel-izlaznost');
        const resultsPanel = document.getElementById('panel-rezultati');
        const debugPanel = document.getElementById('panel-debug');
        if (turnoutPanel) {
          turnoutPanel.classList.toggle('under-construction-panel', showConstruction);
        }
        if (resultsPanel) {
          resultsPanel.classList.toggle('under-construction-panel', showConstruction);
        }

        const activePanel = document.querySelector('.panel.active-panel');
        if (!hasElectionSelection) {
          if (turnoutPanel) turnoutPanel.style.display = 'none';
          if (resultsPanel) resultsPanel.style.display = 'none';
          if (debugPanel) debugPanel.style.display = '';
          if (activePanel && activePanel.id !== 'panel-debug') {
            document.querySelectorAll('.panel').forEach((p) => {
              const shouldShow = p === debugPanel;
              p.style.display = shouldShow ? '' : 'none';
              p.classList.toggle('active-panel', shouldShow);
            });
          }
        } else {
          if (!activePanel) {
            const targetPanel = showParliamentary ? turnoutPanel : resultsPanel;
            if (targetPanel) {
              document.querySelectorAll('.panel').forEach((p) => {
                const shouldShow = p === targetPanel;
                p.style.display = shouldShow ? '' : 'none';
                p.classList.toggle('active-panel', shouldShow);
              });
            }
          }
        }

        updateSidebarNavigationState();
      }

      function updateSidebarNavigationState() {
        const hasElectionSelection = Boolean(activeParliamentaryPhase || activePresidentialPhase || activeLocalPhase);
        document.querySelectorAll('.menu-item').forEach((button) => {
          const panel = button.dataset.panel;
          const disable = !hasElectionSelection && (panel === 'izlaznost' || panel === 'rezultati');
          button.disabled = disable;
          button.classList.toggle('disabled', disable);
          button.setAttribute('aria-disabled', String(disable));
        });
      }

      function clearElectionPhaseSelection(groupName) {
        if (groupName === 'parliamentary') {
          activeParliamentaryPhase = null;
          document.querySelectorAll('input[data-parliamentary-phase]').forEach((input) => {
            input.checked = false;
          });
        }
        if (groupName === 'presidental') {
          activePresidentialPhase = null;
          document.querySelectorAll('input[data-presidental-phase]').forEach((input) => {
            input.checked = false;
          });
        }
        if (groupName === 'local') {
          activeLocalPhase = null;
          document.querySelectorAll('input[data-local-phase]').forEach((input) => {
            input.checked = false;
          });
        }
        updateParliamentaryViewVisibility();
        updateBannerTitle();
      }

      let stopwatchRunning = false;
      let stopwatchElapsedMs = 0;
      let stopwatchStartTs = 0;
      let stopwatchStartedAtTs = null;
      let stopwatchTimerId = null;

      function formatStopwatch(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
      }

      function syncStopwatchDisplay() {
        const locale = getLocaleDictionary();
        const syncClock = (clockId, startedAtId, dateCornerId) => {
          const mainValue = document.getElementById(clockId);
          if (mainValue) mainValue.textContent = formatStopwatch(stopwatchElapsedMs);
          const startedAtValue = document.getElementById(startedAtId);
          const dateCorner = document.getElementById(dateCornerId);
          const startedAtDate = stopwatchStartedAtTs ? new Date(stopwatchStartedAtTs) : null;
          const datePart = startedAtDate ? startedAtDate.toLocaleDateString('en-GB') : '--.--.----';
          const timePart = startedAtDate ? startedAtDate.toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--';
          if (dateCorner) {
            const dateLabel = locale.stopwatchDateLabel || (String(activeLanguage || '').toLowerCase().startsWith('sr') ? 'Датум' : 'Date');
            dateCorner.textContent = `${dateLabel}: ${datePart}`;
          }
          if (startedAtValue) {
            const startedLabel = locale.stopwatchStartedAtLabel || (String(activeLanguage || '').toLowerCase().startsWith('sr') ? 'Покренуто у' : 'Started at');
            startedAtValue.innerHTML = `<span class="started-label">${startedLabel}:</span><span class="started-time">${timePart}</span>`;
          }
        };
        syncClock('durationClock', 'durationStartedAt', 'durationDateCorner');
        syncClock('resultsDurationClock', 'resultsDurationStartedAt', 'resultsDurationDateCorner');

        const stopwatchStartBtn = document.getElementById('stopwatchStartBtn');
        const stopwatchStopBtn = document.getElementById('stopwatchStopBtn');
        if (stopwatchStartBtn) {
          stopwatchStartBtn.classList.toggle('active', !stopwatchRunning);
          stopwatchStartBtn.classList.toggle('idle', stopwatchRunning);
          stopwatchStartBtn.setAttribute('aria-pressed', String(!stopwatchRunning));
        }
        if (stopwatchStopBtn) {
          stopwatchStopBtn.classList.toggle('active', stopwatchRunning);
          stopwatchStopBtn.classList.toggle('idle', !stopwatchRunning);
          stopwatchStopBtn.setAttribute('aria-pressed', String(stopwatchRunning));
        }

        const stopwatchStatus = document.getElementById('stopwatchStatus');
        if (stopwatchStatus) {
          const statusLabel = stopwatchRunning ? (locale.stopwatchRunning || 'Running') : (locale.stopwatchStopped || 'Stopped');
          const durationLabel = locale.stopwatchDurationLabel || 'Duration';
          stopwatchStatus.textContent = `${statusLabel} · ${durationLabel}: ${formatStopwatch(stopwatchElapsedMs)}`;
        }
      }

      function startStopwatch() {
        stopwatchElapsedMs = 0;
        stopwatchStartTs = Date.now();
        stopwatchStartedAtTs = stopwatchStartTs;
        stopwatchRunning = true;
        if (stopwatchTimerId) clearInterval(stopwatchTimerId);
        coverageTimelineSnapshots = [];
        if (cachedConfig) {
          const statuses = Array.isArray(cachedConfig.senderStatuses) ? cachedConfig.senderStatuses : [];
          const regions = getRegions(cachedConfig);
          captureCoverageTimelineSnapshotFromConfig(statuses, regions);
        }
        syncStopwatchDisplay();
        renderCoverageStatusPanel();
        stopwatchTimerId = setInterval(() => {
          if (!stopwatchRunning) return;
          stopwatchElapsedMs = Date.now() - stopwatchStartTs;
          syncStopwatchDisplay();
        }, 1000);
      }

      function stopStopwatch() {
        stopwatchRunning = false;
        if (stopwatchTimerId) {
          clearInterval(stopwatchTimerId);
          stopwatchTimerId = null;
        }
        if (stopwatchStartTs) {
          stopwatchElapsedMs = Date.now() - stopwatchStartTs;
        }
        syncStopwatchDisplay();
        renderCoverageStatusPanel();
      }

      function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
      function numericCell(content, className = '') {
        return `<td class="numeric-cell${className ? ` ${className}` : ''}">${content}</td>`;
      }

      function formatNumber(n) { return Intl.NumberFormat('de-DE').format(Number(n || 0)); }
      function formatRegisteredWithRik(count, rikCount, locale = getLocaleDictionary()) {
        const value = Number(count || 0);
        const rikValue = rikCount != null && Number(rikCount) > 0 ? Number(rikCount) : null;
        if (rikValue == null) {
          return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span></span>`;
        }
        return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span><span class="registered-count-rik">${formatNumber(rikValue)} <span class="registered-count-source">${locale.rikSource || 'Source RIK'}</span></span></span>`;
      }
      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      function normalizeCoverageResolutionMinutes(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.max(1, Math.floor(parsed));
      }

      function getRegions(config) {
        if (!config) return [];
        if (Array.isArray(config.regions)) return config.regions;
        if (Array.isArray(config.votingUnits)) {
          const out = [];
          config.votingUnits.forEach(unit => {
            if (Array.isArray(unit.regions)) {
              unit.regions.forEach(region => out.push(region));
            }
          });
          return out;
        }
        return [];
      }

      function collectVotingPlaces(config) {
        const places = [];
        getRegions(config || {}).forEach(region => {
          if (Array.isArray(region.municipalities)) {
            region.municipalities.forEach(mun => {
              (mun.places || []).forEach(place => places.push(place));
            });
          }
          if (Array.isArray(region.places)) {
            region.places.forEach(place => {
              if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
                place.subPlaces.forEach(sub => places.push(sub));
              } else {
                places.push(place);
              }
            });
          }
        });
        return places;
      }

      function getPlaceSenders(place) {
        if (!place) return [];
        if (Array.isArray(place.sender)) return place.sender;
        if (Array.isArray(place.senders)) return place.senders;
        return [];
      }

      function collectRegionVotingPlaces(region) {
        const places = [];
        if (!region || typeof region !== 'object') return places;
        if (Array.isArray(region.municipalities)) {
          region.municipalities.forEach(mun => {
            (mun.places || []).forEach(place => places.push(place));
          });
        }
        if (Array.isArray(region.places)) {
          region.places.forEach(place => {
            if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
              place.subPlaces.forEach(sub => places.push(sub));
            } else {
              places.push(place);
            }
          });
        }
        return places;
      }

      function getPlaceSenderStatusId(place) {
        const senders = getPlaceSenders(place);
        return String((place && place.senderStatus) || (senders[0] && senders[0].senderStatus) || '0').trim();
      }

      function getSenderStatusAlias(status, isSerbian) {
        if (!status || typeof status !== 'object') return '';
        if (isSerbian) {
          return String(status.alias_sr || status['alias-sr'] || status.alias || '').trim();
        }
        return String(status.alias_en || '').trim();
      }

      function getSenderStatusDisplayName(status) {
        const parts = getSenderStatusDisplayParts(status);
        return parts.alias ? `${parts.name} (${parts.alias})` : parts.name;
      }

      function getSenderStatusDisplayParts(status) {
        const locale = getLocaleDictionary();
        const language = String(activeLanguage || '').toLowerCase();
        const isSerbian = language.startsWith('sr');
        const signalStatusLabels = (locale && locale.signalStatusLabels) || {};
        const statusId = String(status && status.id != null ? status.id : '');
        const multilingualName = signalStatusLabels[statusId] || signalStatusLabels[Number(statusId)] || null;

        const name = multilingualName || (
          isSerbian
            ? (status.name_sr || status.name_se || status.name_en || `ID ${status.id}`)
            : (status.name_en || status.name_sr || status.name_se || `ID ${status.id}`)
        );
        const alias = getSenderStatusAlias(status, isSerbian);
        return { name, alias };
      }

      function getResultCandidates(config) {
        const rootCandidates = Array.isArray(config && config.result && config.result.candidateVotes)
          ? config.result.candidateVotes
          : [];
        if (rootCandidates.length) {
          return rootCandidates.map((candidate) => ({
            id: String(candidate.id),
            alias: String(candidate.alias || candidate.name || `ID ${candidate.id}`).trim(),
            name: String(candidate.name || candidate.alias || `ID ${candidate.id}`).trim()
          }));
        }

        const regions = getRegions(config);
        for (const region of regions) {
          const places = [];
          (region.municipalities || []).forEach((municipality) => places.push(...(municipality.places || [])));
          (region.places || []).forEach((place) => {
            if (Array.isArray(place.subPlaces) && place.subPlaces.length) places.push(...place.subPlaces);
            else places.push(place);
          });
          for (const place of places) {
            const candidateVotes = Array.isArray(place && place.result && place.result.candidateVotes)
              ? place.result.candidateVotes
              : [];
            if (candidateVotes.length) {
              return candidateVotes.map((candidate) => ({
                id: String(candidate.id),
                alias: String(candidate.alias || candidate.name || `ID ${candidate.id}`).trim(),
                name: String(candidate.name || candidate.alias || `ID ${candidate.id}`).trim()
              }));
            }
          }
        }
        return [];
      }

      function getResultVotesMap(place, candidateIds) {
        const voteMap = new Map();
        const candidateVotes = Array.isArray(place && place.result && place.result.candidateVotes)
          ? place.result.candidateVotes
          : [];
        candidateIds.forEach((candidateId) => {
          const voteEntry = candidateVotes.find((candidate) => String(candidate.id) === String(candidateId));
          voteMap.set(String(candidateId), Number(voteEntry && voteEntry.votes) || 0);
        });
        return voteMap;
      }

      function sumVoteMap(target, source) {
        source.forEach((value, key) => {
          target.set(key, (Number(target.get(key) || 0) + Number(value || 0)));
        });
        return target;
      }

      function getResultStats(place, candidateIds) {
        const votes = getResultVotesMap(place, candidateIds);
        let total = 0;
        votes.forEach((value) => {
          total += Number(value || 0);
        });
        return { votes, total };
      }

      function getBallotTotalsForResult(result, votedTotal = 0) {
        const nonValidValues = Array.isArray(result && result.nonValidVotes) ? result.nonValidVotes : [];
        const inferredNonValid = nonValidValues.reduce((sum, item) => sum + Number(item && item.votes || 0), 0);
        const nonValid = Number((result && result.nonRegularBallots) != null ? result.nonRegularBallots : inferredNonValid);
        const remaining = Number(result && result.remainingBallots || 0);
        const totalVoted = Number(votedTotal || 0);
        const valid = Math.max(totalVoted - nonValid, 0);
        return { valid, nonValid, remaining };
      }

      function getCoverageTimelineLocale() {
        const isSerbian = String(activeLanguage || '').toLowerCase().startsWith('sr');
        if (isSerbian) {
          return {
            resolutionLabel: 'Rezolucija (min)',
            emptyText: 'Nema podataka za prikaz',
            startStopwatchText: 'Pokreni štopericu za praćenje promena'
          };
        }
        return {
          resolutionLabel: 'Resolution (min)',
          emptyText: 'No data to display',
          startStopwatchText: 'Start stopwatch to track changes'
        };
      }

      function createStatusCountRecord(statuses) {
        const output = {};
        (statuses || []).forEach((status) => {
          output[String(status.id)] = 0;
        });
        return output;
      }

      function buildCoverageStatusCountsByRegion(statuses, regions) {
        const countsByRegion = { ALL: createStatusCountRecord(statuses) };
        (regions || []).forEach((region) => {
          const regionKey = String(region.id);
          countsByRegion[regionKey] = createStatusCountRecord(statuses);
          collectRegionVotingPlaces(region).forEach((place) => {
            const statusId = getPlaceSenderStatusId(place);
            countsByRegion.ALL[statusId] = Number(countsByRegion.ALL[statusId] || 0) + 1;
            countsByRegion[regionKey][statusId] = Number(countsByRegion[regionKey][statusId] || 0) + 1;
          });
        });
        return countsByRegion;
      }

      async function refreshConfigFromVersionIfChanged() {
        try {
          const versionResponse = await fetch('/api/config-version');
          const versionPayload = await versionResponse.json();
          const nextToken = `${versionPayload.mtimeMs}:${versionPayload.size}`;
          if (coverageConfigVersionToken && coverageConfigVersionToken === nextToken) {
            return false;
          }
          const configResponse = await fetch('/api/config');
          const config = await configResponse.json();
          cachedConfig = config;
          coverageConfigVersionToken = nextToken;
          return true;
        } catch (error) {
          console.warn('Failed to refresh config by version:', error && error.message ? error.message : error);
          return false;
        }
      }

      function captureCoverageTimelineSnapshotFromConfig(statuses, regions) {
        if (!cachedConfig) return;
        const resolutionMinutes = normalizeCoverageResolutionMinutes(coverageTimelineResolutionMinutes);
        const resolutionMs = resolutionMinutes * 60 * 1000;
        const bucketTs = Math.floor(Date.now() / resolutionMs) * resolutionMs;
        const countsByRegion = buildCoverageStatusCountsByRegion(statuses, regions);
        const last = coverageTimelineSnapshots[coverageTimelineSnapshots.length - 1];
        if (last && last.bucketTs === bucketTs) {
          last.countsByRegion = countsByRegion;
          return;
        }
        coverageTimelineSnapshots.push({ bucketTs, countsByRegion });
        if (coverageTimelineSnapshots.length > 288) {
          coverageTimelineSnapshots = coverageTimelineSnapshots.slice(-288);
        }
      }

      function renderCoverageStatusTimeline(statuses) {
        const timelineHost = document.getElementById('coverageStatusTimeline');
        if (!timelineHost) return;
        const localeStrings = getCoverageTimelineLocale();
        if (!stopwatchRunning && coverageTimelineSnapshots.length === 0) {
          timelineHost.innerHTML = `<div class="coverage-timeline-empty">${localeStrings.startStopwatchText}</div>`;
          return;
        }

        const regionKey = coverageRegionFilter === 'ALL' ? 'ALL' : String(coverageRegionFilter);
        const bucketKeys = coverageTimelineSnapshots
          .filter((entry) => entry && entry.countsByRegion && entry.countsByRegion[regionKey])
          .map((entry) => Number(entry.bucketTs))
          .sort((a, b) => a - b);
        const snapshotByBucketTs = new Map(coverageTimelineSnapshots.map((entry) => [Number(entry.bucketTs), entry]));
        if (!bucketKeys.length) {
          timelineHost.innerHTML = `<div class="coverage-timeline-empty">${localeStrings.emptyText}</div>`;
          return;
        }

        const statusList = Array.isArray(statuses) ? statuses : [];
        const statusIds = statusList.map(status => String(status.id));

        const seriesByStatus = new Map();
        let maxValue = 0;
        statusIds.forEach((statusId) => {
          const values = bucketKeys.map((key) => {
            const snapshot = snapshotByBucketTs.get(key);
            const value = Number(snapshot && snapshot.countsByRegion && snapshot.countsByRegion[regionKey]
              ? snapshot.countsByRegion[regionKey][statusId]
              : 0);
            if (value > maxValue) maxValue = value;
            return value;
          });
          seriesByStatus.set(statusId, values);
        });
        maxValue = Math.max(1, maxValue);

        const svgWidth = 620;
        const svgHeight = 210;
        const padLeft = 36;
        const padRight = 10;
        const padTop = 8;
        const padBottom = 28;
        const innerWidth = svgWidth - padLeft - padRight;
        const innerHeight = svgHeight - padTop - padBottom;
        const xForIndex = (index) => padLeft + (bucketKeys.length === 1 ? innerWidth / 2 : (index * innerWidth) / (bucketKeys.length - 1));
        const yForValue = (value) => padTop + innerHeight - ((value / maxValue) * innerHeight);
        const timeSpan = bucketKeys[bucketKeys.length - 1] - bucketKeys[0];
        const withDate = timeSpan >= 24 * 60 * 60 * 1000;
        const formatBucketLabel = (timestamp) => {
          const date = new Date(timestamp);
          const timePart = date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
          return withDate ? `${date.toLocaleDateString('en-GB')} ${timePart}` : timePart;
        };

        const lines = statusIds.map((statusId, index) => {
          const values = seriesByStatus.get(statusId) || [];
          const points = values.map((value, pointIndex) => `${xForIndex(pointIndex)},${yForValue(value)}`).join(' ');
          return `<polyline fill="none" stroke="${COVERAGE_STATUS_COLORS[index % COVERAGE_STATUS_COLORS.length]}" stroke-width="2" points="${points}" />`;
        }).join('');

        const xTickIndexes = [0, Math.floor((bucketKeys.length - 1) / 2), bucketKeys.length - 1]
          .filter((value, index, arr) => arr.indexOf(value) === index);
        const xTicks = xTickIndexes.map((idx) => `
          <text x="${xForIndex(idx)}" y="${svgHeight - 8}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(formatBucketLabel(bucketKeys[idx]))}</text>
        `).join('');

        timelineHost.innerHTML = `
          <svg class="coverage-timeline-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none" aria-label="Sender status timeline">
            <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${svgHeight - padBottom}" stroke="#cbd5e1" stroke-width="1" />
            <line x1="${padLeft}" y1="${svgHeight - padBottom}" x2="${svgWidth - padRight}" y2="${svgHeight - padBottom}" stroke="#cbd5e1" stroke-width="1" />
            <line x1="${padLeft}" y1="${yForValue(maxValue)}" x2="${svgWidth - padRight}" y2="${yForValue(maxValue)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2 3" />
            <text x="4" y="${yForValue(maxValue) + 3}" font-size="10" fill="#64748b">${formatNumber(maxValue)}</text>
            <text x="8" y="${svgHeight - padBottom + 3}" font-size="10" fill="#64748b">0</text>
            ${lines}
            ${xTicks}
          </svg>
        `;
      }

      function renderCoverageStatusPanel() {
        const panel = document.getElementById('turnout-tab-coverage');
        if (!panel || !cachedConfig) return;

        const regions = getRegions(cachedConfig);
        const regionMap = new Map(regions.map(region => [String(region.id), region]));
        if (coverageRegionFilter !== 'ALL' && !regionMap.has(coverageRegionFilter)) {
          coverageRegionFilter = 'ALL';
        }

        const statuses = Array.isArray(cachedConfig.senderStatuses) ? cachedConfig.senderStatuses : [];
        const selectedRegions = coverageRegionFilter === 'ALL'
          ? regions
          : (regionMap.get(coverageRegionFilter) ? [regionMap.get(coverageRegionFilter)] : []);

        const places = [];
        selectedRegions.forEach(region => {
          collectRegionVotingPlaces(region).forEach(place => places.push(place));
        });

        const statusCounts = new Map();
        places.forEach(place => {
          const statusId = getPlaceSenderStatusId(place);
          // For "Inactive" (status 0): only count places that have a registered controller
          if (statusId === '0') {
            const senders = getPlaceSenders(place);
            const hasController = senders.some(s => String((s && s.signalUser) || '').trim() !== 'TBD');
            if (!hasController) return;
          }
          statusCounts.set(statusId, (statusCounts.get(statusId) || 0) + 1);
        });

        const statusColorById = new Map(statuses.map((status, index) => [String(status.id), COVERAGE_STATUS_COLORS[index % COVERAGE_STATUS_COLORS.length]]));
        const knownStatusIds = new Set();
        const statusRows = statuses.map(status => {
          const statusId = String(status.id);
          const color = statusColorById.get(statusId) || '#0f172a';
          knownStatusIds.add(statusId);
          const displayParts = getSenderStatusDisplayParts(status);
          const aliasHtml = displayParts.alias
            ? ` <span class="status-alias" style="color:${color}">(${escapeHtml(displayParts.alias)})</span>`
            : '';
          return `
            <div class="coverage-status-row">
              <span class="status-name" style="color:${color}">${escapeHtml(displayParts.name)}${aliasHtml}</span>
              <span class="status-count">${formatNumber(statusCounts.get(statusId) || 0)}</span>
            </div>
          `;
        });

        statusCounts.forEach((count, statusId) => {
          if (knownStatusIds.has(statusId)) return;
          statusRows.push(`
            <div class="coverage-status-row">
              <span class="status-name">ID ${statusId}</span>
              <span class="status-count">${formatNumber(count)}</span>
            </div>
          `);
        });

        panel.innerHTML = `
          <div class="coverage-tab-layout">
            <div class="coverage-tab-left">
              <select id="coverageRegionSelect" class="coverage-tab-filter" aria-label="Region filter">
                <option value="ALL"${coverageRegionFilter === 'ALL' ? ' selected' : ''}>ALL</option>
                ${regions.map(region => `<option value="${String(region.id)}"${coverageRegionFilter === String(region.id) ? ' selected' : ''}>${region.name}</option>`).join('')}
              </select>
              <div class="coverage-status-list">
                ${statusRows.join('')}
              </div>
            </div>
            <div class="coverage-tab-right">
              <div class="coverage-timeline-box">
                <div class="coverage-timeline-controls">
                  <label class="coverage-timeline-label" for="coverageResolutionMinutes">${getCoverageTimelineLocale().resolutionLabel}</label>
                  <input id="coverageResolutionMinutes" class="coverage-timeline-resolution" type="number" min="1" step="1" value="${normalizeCoverageResolutionMinutes(coverageTimelineResolutionMinutes)}" />
                </div>
                <div id="coverageStatusTimeline"></div>
              </div>
            </div>
          </div>
        `;

        const regionSelect = document.getElementById('coverageRegionSelect');
        if (regionSelect) {
          regionSelect.addEventListener('change', (event) => {
            coverageRegionFilter = event.target.value || 'ALL';
            renderCoverageStatusPanel();
          });
        }

        const resolutionInput = document.getElementById('coverageResolutionMinutes');
        if (resolutionInput) {
          resolutionInput.addEventListener('change', (event) => {
            coverageTimelineResolutionMinutes = normalizeCoverageResolutionMinutes(event.target.value);
            coverageTimelineSnapshots = [];
            if (stopwatchRunning && cachedConfig) {
              captureCoverageTimelineSnapshotFromConfig(statuses, regions);
            }
            renderCoverageStatusPanel();
          });
        }

        renderCoverageStatusTimeline(statuses);
      }

      function attachRegionChartToggle() {
        const chart = document.getElementById('regionChart');
        const toggle = document.getElementById('regionChartToggle');
        const content = document.getElementById('regionChartContent');
        if (!chart || !toggle || !content) return;

        const syncState = () => {
          const collapsed = chart.classList.contains('collapsed');
          toggle.dataset.expanded = collapsed ? '0' : '1';
          toggle.textContent = collapsed ? '▶' : '▼';
          content.style.display = collapsed ? 'none' : '';
        };

        syncState();
        toggle.addEventListener('click', () => {
          chart.classList.toggle('collapsed');
          syncState();
        });
      }

      function attachResultsChartToggle() {
        const chart = document.getElementById('resultsRegionChart');
        const toggle = document.getElementById('resultsRegionChartToggle');
        const content = document.getElementById('resultsRegionChartContent');
        if (!chart || !toggle || !content) return;

        const syncState = () => {
          const collapsed = chart.classList.contains('collapsed');
          toggle.dataset.expanded = collapsed ? '0' : '1';
          toggle.textContent = collapsed ? '▶' : '▼';
          content.style.display = collapsed ? 'none' : '';
        };

        syncState();
        toggle.addEventListener('click', () => {
          chart.classList.toggle('collapsed');
          syncState();
        });
      }

      async function loadConfigAndBuild() {
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        cachedConfig = config;
        try {
          const versionResponse = await fetch('/api/config-version');
          const versionPayload = await versionResponse.json();
          coverageConfigVersionToken = `${versionPayload.mtimeMs}:${versionPayload.size}`;
        } catch (error) {
          console.warn('Failed to initialize config version token:', error && error.message ? error.message : error);
        }
        activeLanguage = (config && config.defaultLanguage) || activeLanguage || 'sr';

        buildSidebarMenu(config);
        renderSidebarLanguageSelector(config);
        setupLanguageSelector(config);
        buildRegionsTree(config);
        buildRegionCards(config);
        buildResultsCards(config);
        buildResultsTree(config);
        buildIrregularitiesTree(config);
        buildZapTree(config);
        setZapLabels();
        setupIrregularitiesSplitter();
        refreshLocalizedStaticLabels();
        updateParliamentaryViewVisibility();
        attachRegionChartToggle();
        attachResultsChartToggle();
      }

      function buildRegionCards(config) {
        const regionCards = document.getElementById('regionCards');
        if (!regionCards) return;
        const locale = getLocaleDictionary();
        regionCards.innerHTML = '';

        const card1 = document.createElement('div');
        card1.className = 'card';
        card1.innerHTML = `<h3>${locale.totalRegistered}</h3><div class="value summary-big"><span id="totalRegistered">0</span> <span class="summary-percent" id="totalRegisteredPercent"></span></div><div class="small rik-source-line"><span id="rikTotalRegistered">--</span> <span id="rikSourceRegistered"></span></div>`;
        regionCards.appendChild(card1);

        const card2 = document.createElement('div');
        card2.className = 'card';
        card2.innerHTML = `<h3>${locale.totalVotingPlaces || 'Total voting places'}</h3><div class="value summary-big"><span id="totalVotingPlaces">0</span> <span class="summary-percent" id="totalVotingPlacesPercent">(100.00%)</span></div><div class="small rik-source-line"><span id="rikTotalVotingPlaces">--</span> <span id="rikSourceVotingPlaces"></span></div>`;
        regionCards.appendChild(card2);

        const card3 = document.createElement('div');
        card3.className = 'card';
        card3.innerHTML = `<h3>${locale.totalVoted || 'Total voters who turned out'}</h3><div class="value summary-big"><span id="totalCollected">0</span> <span class="summary-percent" id="totalPercent"></span></div><div class="duration-started-at turnout-breakdown-line"><span id="totalCollectedInPlaceLabel" class="started-label">${locale.turnoutInPlaceLabel || 'In Place:'}</span><span class="started-time" id="totalCollectedInPlace">0</span><span id="totalCollectedFromHomeLabel" class="started-label">${locale.turnoutFromHomeLabel || 'From Home:'}</span><span class="started-time" id="totalCollectedFromHome">0</span></div>`;
        regionCards.appendChild(card3);

        const card4 = document.createElement('div');
        card4.className = 'card';
        card4.innerHTML = `<div id="durationDateCorner" class="duration-date-corner"></div><h3>${locale.duration || 'DURATION'}</h3><div id="durationClock" class="value">00:00:00</div><div id="durationStartedAt" class="duration-started-at duration-started-grid"><span class="started-label">--</span><span class="started-time">--:--:--</span></div>`;
        regionCards.appendChild(card4);

        const card5 = document.createElement('div');
        card5.className = 'card';
        card5.innerHTML = `
          <h3>${locale.coverage || 'COVERAGE'}</h3>
          <div class="coverage-row">
            <span class="coverage-label coverage-registered">${locale.registeredControllers || 'Number of Registered Controllers'}</span>
            <span class="coverage-colon">:</span>
            <strong id="registeredControllers">0</strong>
            <span class="coverage-percent" id="registeredControllersPercent">(0.00%)</span>
          </div>
          <div class="coverage-row">
            <span class="coverage-label coverage-active">${locale.activeControllers || 'Number of Active Controllers'}</span>
            <span class="coverage-colon">:</span>
            <strong id="activeControllers">0</strong>
            <span class="coverage-percent" id="activeControllersPercent">(0.00%)</span>
          </div>
        `;
        regionCards.appendChild(card5);

        syncStopwatchDisplay();
      }

      function buildRegionsTree(config) {
        const container = document.getElementById('regionsTree');
        if (!container) return;
        const locale = getLocaleDictionary();
        container.innerHTML = '';
        globalThis.cleanupTurnoutTableViewport?.();
        const regions = getRegions(config);

        // build table
        const table = el('table');
        table.className = 'regions-table';
        const thead = el('thead');
        thead.innerHTML = `
          <tr>
            <th id="tableHeaderName" rowspan="2" style="width:34%">${locale.tableName || 'Name'}</th>
            <th id="tableHeaderRegistered" rowspan="2" style="width:11%">${locale.tableRegistered || 'Registered'}</th>
            <th id="tableHeaderVoted" colspan="2" class="group-header" style="width:22%">${locale.tableVoted || 'Voted'}</th>
            <th id="tableHeaderTurnout" colspan="2" class="group-header" style="width:22%">${locale.tableTurnout || 'Turnout'}</th>
            <th id="tableHeaderControllerActivity" rowspan="2" style="width:11%">${locale.tableControllerActivity || 'Controller Activity'}</th>
          </tr>
          <tr>
            <th id="tableHeaderVotedInPlace">${locale.tableVotedInPlace || 'Voted in Place'}</th>
            <th id="tableHeaderVotedFromHome">${locale.tableVotedFromHome || 'Voted from Home'}</th>
            <th id="tableHeaderTurnoutNumber">${locale.tableTurnoutNumber || 'Number'}</th>
            <th id="tableHeaderTurnoutPercent">${locale.tableTurnoutPercent || 'Percentage'}</th>
          </tr>`;
        table.appendChild(thead);
        const tbody = el('tbody');

        function activityCell(senderStatus, rowKey = '') {
          const s = String(senderStatus ?? '0');
          const key = `controllerStatus${s}`;
          const label = locale[key] || locale.controllerStatus0 || 'Not Covered';
          const id = rowKey ? ` id="results-activity-${rowKey}"` : '';
          return `<td><span${id} class="ctrl-status ctrl-status-${s}">${label}</span></td>`;
        }

        function formatRegisteredWithRik(count, rikCount) {
          const value = Number(count || 0);
          const rikValue = rikCount != null && Number(rikCount) > 0 ? Number(rikCount) : null;
          if (rikValue == null) {
            return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span></span>`;
          }
          return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span><span class="registered-count-rik">${formatNumber(rikValue)} <span class="registered-count-source">${locale.rikSource || 'Source RIK'}</span></span></span>`;
        }

        function numericCell(content, className = '') {
          return `<td class="numeric-cell${className ? ` ${className}` : ''}">${content}</td>`;
        }

        // lazy-build helpers: only construct child rows the first time a node is expanded,
        // instead of building the full 8000+ row tree up front.
        function createPlaceRow(place, parentId) {
          const placeRow = el('tr');
          placeRow.className = 'place-row hidden-row';
          placeRow.dataset.parent = parentId;
          placeRow.dataset.id = `place-${place.id}`;
          placeRow.innerHTML = `<td>${place.name}</td><td><span id="place-registered-${place.id}">${place.registeredVoters || 0}</span></td>${numericCell(`<span id="place-in-place-${place.id}">0</span>`)}${numericCell(`<span id="place-from-home-${place.id}">0</span>`)}${numericCell(`<span id="place-total-${place.id}">0</span>`, 'turnout-total-cell')}${numericCell(`<span id="place-percent-${place.id}">0%</span>`, 'turnout-percent-cell')}${activityCell(place.senderStatus)}`;
          return placeRow;
        }

        function attachLazyToggle(row, buildChildren) {
          const btn = row.querySelector('.collapse-btn');
          if (!btn) return;
          btn.addEventListener('click', () => {
            const expanded = btn.dataset.expanded === '1';
            const show = !expanded;
            btn.dataset.expanded = show ? '1' : '0';
            btn.textContent = show ? '▼' : '▶';
            if (show && buildChildren && !row.dataset.built) {
              row.dataset.built = '1';
              const childRows = buildChildren() || [];
              if (childRows.length) row.after(...childRows);
            }
            toggleChildren(row.dataset.id, show);
          });
        }

        function createMunRow(region, mun) {
          const munId = `mun-${region.id}-${mun.id}`;
          const munRow = el('tr');
          munRow.className = 'mun-row hidden-row';
          munRow.dataset.parent = `region-${region.id}`;
          munRow.dataset.id = munId;
          munRow.innerHTML = `<td><button class="collapse-btn" data-target="${munId}">▶</button> ${mun.name}</td><td id="mun-registered-${region.id}-${mun.id}">${formatRegisteredWithRik(mun.totalMunicipalityRegisteredVoters, mun.RIK_totalMunicipalityRegisteredVoters)}</td>${numericCell(`<span id="mun-in-place-${region.id}-${mun.id}">0</span>`)}${numericCell(`<span id="mun-from-home-${region.id}-${mun.id}">0</span>`)}${numericCell(`<span id="mun-total-${region.id}-${mun.id}">0</span>`, 'turnout-total-cell')}${numericCell(`<span id="mun-percent-${region.id}-${mun.id}">0%</span>`, 'turnout-percent-cell')}<td></td>`;
          attachLazyToggle(munRow, () => (mun.places || []).map(place => createPlaceRow(place, munId)));
          return munRow;
        }

        function createPlaceGroupRow(region, place) {
          const groupId = `mun-${region.id}-${place.id}`;
          const parentRow = el('tr');
          parentRow.className = 'mun-row hidden-row';
          parentRow.dataset.parent = `region-${region.id}`;
          parentRow.dataset.id = groupId;
          parentRow.innerHTML = `<td><button class="collapse-btn" data-target="${groupId}">▶</button> ${place.name}</td><td></td>${numericCell('')}${numericCell('')}${numericCell('', 'turnout-total-cell')}${numericCell('', 'turnout-percent-cell')}<td></td>`;
          attachLazyToggle(parentRow, () => (place.subPlaces || []).map(sub => createPlaceRow(sub, groupId)));
          return parentRow;
        }

        function createRegionRow(region) {
          const regionId = `region-${region.id}`;
          const regionRow = el('tr');
          regionRow.className = 'region-row';
          regionRow.dataset.id = regionId;
          regionRow.innerHTML = `<td><button class="collapse-btn" data-target="${regionId}">▶</button> <strong>${region.name}</strong></td><td id="region-registered-${region.id}">${formatRegisteredWithRik(region.totalRegionRegisteredVoters, region.RIK_totalRegionRegisteredVoters)}</td>${numericCell(`<span id="region-in-place-${region.id}">0</span>`)}${numericCell(`<span id="region-from-home-${region.id}">0</span>`)}${numericCell(`<span id="region-total-${region.id}">0</span>`, 'turnout-total-cell')}${numericCell(`<span id="region-percent-${region.id}">0%</span>`, 'turnout-percent-cell')}<td></td>`;
          attachLazyToggle(regionRow, () => {
            const rows = [];
            if (Array.isArray(region.municipalities) && region.municipalities.length) {
              region.municipalities.forEach(mun => rows.push(createMunRow(region, mun)));
            }
            if (Array.isArray(region.places) && region.places.length) {
              region.places.forEach(place => {
                if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
                  rows.push(createPlaceGroupRow(region, place));
                } else {
                  rows.push(createPlaceRow(place, regionId));
                }
              });
            }
            return rows;
          });
          return regionRow;
        }

        regions.forEach(region => {
          tbody.appendChild(createRegionRow(region));
        });

        table.appendChild(tbody);

        const tableScroll = document.createElement('div');
        tableScroll.className = 'results-table-scroll';
        tableScroll.appendChild(table);

        const stickyHeaderViewport = document.createElement('div');
        stickyHeaderViewport.className = 'results-sticky-header-viewport';
        const stickyHeaderTable = document.createElement('table');
        stickyHeaderTable.className = 'regions-table results-sticky-header-table';
        stickyHeaderTable.innerHTML = thead.outerHTML;
        stickyHeaderTable.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
        thead.style.visibility = 'hidden';
        stickyHeaderViewport.appendChild(stickyHeaderTable);

        const headerDiv = el('div');
        headerDiv.className = 'table-header';
        headerDiv.innerHTML = `<button id="pregledBtn" class="collapse-btn" data-expanded="1">▼</button> <strong id="regionsSummaryTitle">${locale.regionSummaryTitle || 'Pregled'}</strong>`;
        container.appendChild(headerDiv);
        container.appendChild(stickyHeaderViewport);
        container.appendChild(tableScroll);

        const syncStickyHeaderMetrics = () => {
          stickyHeaderTable.style.width = `${table.getBoundingClientRect().width}px`;
          stickyHeaderTable.style.transform = `translateX(${-tableScroll.scrollLeft}px)`;
          stickyHeaderTable.querySelectorAll('th').forEach((headerCell, index) => {
            const sourceCell = thead.querySelectorAll('th')[index];
            if (sourceCell) headerCell.style.width = `${sourceCell.getBoundingClientRect().width}px`;
          });
        };
        syncStickyHeaderMetrics();

        const bottomScrollbar = document.createElement('div');
        bottomScrollbar.id = 'turnoutBottomScrollbar';
        bottomScrollbar.className = 'results-bottom-scrollbar';
        bottomScrollbar.innerHTML = '<div class="results-bottom-scrollbar-content"></div>';
        document.body.appendChild(bottomScrollbar);
        const bottomScrollbarContent = bottomScrollbar.firstElementChild;
        const mainScrollContainer = document.querySelector('.main');
        let syncingBottomScrollbar = false;
        const syncBottomScrollbarMetrics = () => {
          const rect = container.getBoundingClientRect();
          bottomScrollbar.style.left = `${Math.max(0, rect.left)}px`;
          bottomScrollbar.style.width = `${Math.max(0, window.innerWidth - Math.max(0, rect.left))}px`;
          const contentWidth = Math.max(tableScroll.scrollWidth, table.scrollWidth);
          bottomScrollbarContent.style.width = `${contentWidth}px`;
          bottomScrollbar.style.display = contentWidth > tableScroll.clientWidth ? 'block' : 'none';
          bottomScrollbar.scrollLeft = tableScroll.scrollLeft;
        };
        bottomScrollbar.addEventListener('scroll', () => {
          if (syncingBottomScrollbar) return;
          syncingBottomScrollbar = true;
          tableScroll.scrollLeft = bottomScrollbar.scrollLeft;
          syncingBottomScrollbar = false;
        });
        tableScroll.addEventListener('scroll', () => {
          if (syncingBottomScrollbar) return;
          syncingBottomScrollbar = true;
          bottomScrollbar.scrollLeft = tableScroll.scrollLeft;
          syncingBottomScrollbar = false;
          syncStickyHeaderMetrics();
        });
        const updateTurnoutTableStickyOffset = () => {
          const banner = document.querySelector('.page-banner');
          const bannerBottom = banner ? Math.max(0, banner.getBoundingClientRect().bottom) : 0;
          stickyHeaderViewport.style.setProperty('--results-table-sticky-top', `${bannerBottom}px`);
          const tableRect = tableScroll.getBoundingClientRect();
          const headerHeight = stickyHeaderViewport.offsetHeight;
          const shouldPin = tableRect.top <= bannerBottom && tableRect.bottom > bannerBottom + headerHeight;
          stickyHeaderViewport.classList.toggle('is-pinned', shouldPin);
          if (shouldPin) {
            stickyHeaderViewport.style.left = `${tableRect.left}px`;
            stickyHeaderViewport.style.width = `${tableScroll.clientWidth}px`;
          } else {
            stickyHeaderViewport.style.left = '';
            stickyHeaderViewport.style.width = '';
          }
          syncStickyHeaderMetrics();
          syncBottomScrollbarMetrics();
        };
        const turnoutTableResizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => {
            syncBottomScrollbarMetrics();
            syncStickyHeaderMetrics();
          })
          : null;
        turnoutTableResizeObserver?.observe(container);
        turnoutTableResizeObserver?.observe(table);
        turnoutTableResizeObserver?.observe(stickyHeaderTable);
        turnoutTableResizeObserver?.observe(stickyHeaderViewport);
        globalThis.cleanupTurnoutTableViewport = () => {
          window.removeEventListener('resize', updateTurnoutTableStickyOffset);
          window.removeEventListener('scroll', updateTurnoutTableStickyOffset);
          mainScrollContainer?.removeEventListener('scroll', updateTurnoutTableStickyOffset);
          turnoutTableResizeObserver?.disconnect();
          bottomScrollbar.remove();
          if (globalThis.cleanupTurnoutTableViewport) {
            delete globalThis.cleanupTurnoutTableViewport;
          }
        };
        window.addEventListener('resize', updateTurnoutTableStickyOffset);
        window.addEventListener('scroll', updateTurnoutTableStickyOffset, { passive: true });
        mainScrollContainer?.addEventListener('scroll', updateTurnoutTableStickyOffset, { passive: true });
        updateTurnoutTableStickyOffset();

        // collapse/expand the entire table body when Pregled is toggled
        (function attachPregled() {
          const btn = container.querySelector('#pregledBtn');
          const tbodyEl = table.querySelector('tbody');
          if (!btn || !tbodyEl) return;
          btn.addEventListener('click', () => {
            const expanded = btn.dataset.expanded === '1';
            const show = !expanded;
            btn.dataset.expanded = show ? '1' : '0';
            btn.textContent = show ? '▼' : '▶';
            // when hiding, keep the header (thead) visible but hide tbody
            tbodyEl.style.display = show ? '' : 'none';
          });
        })();

        // attach collapse handlers for region/mun/place rows
        function toggleChildren(parentId, show) {
          // find direct children whose data-parent exactly equals parentId
          const directChildren = Array.from(container.querySelectorAll(`tr[data-parent="${parentId}"]`));
          directChildren.forEach(child => {
            if (show) child.classList.remove('hidden-row'); else child.classList.add('hidden-row');
            // if hiding, also collapse any expanded child nodes and recursively hide all descendants
            if (!show) {
              const childBtn = child.querySelector('.collapse-btn');
              if (childBtn) { childBtn.dataset.expanded = '0'; childBtn.textContent = '▶'; }
              // recursively hide descendants
              const childId = child.dataset.id;
              if (childId) toggleChildren(childId, false);
            } else {
              // when showing, only auto-expand descendants if their own button is marked expanded
              const childId = child.dataset.id;
              const childBtn = child.querySelector('.collapse-btn');
              if (childBtn && childBtn.dataset.expanded === '1' && childId) {
                // reveal grandchildren
                toggleChildren(childId, true);
              }
            }
          });
        }
      }

      function buildResultsCards(config) {
        const resultsCards = document.getElementById('resultsRegionCards');
        if (!resultsCards) return;
        const locale = getLocaleDictionary();
        resultsCards.innerHTML = '';

        const card1 = document.createElement('div');
        card1.className = 'card';
        card1.innerHTML = `<h3>${locale.totalRegistered}</h3><div class="value summary-big"><span id="resultsTotalRegistered">0</span> <span class="summary-percent" id="resultsTotalRegisteredPercent"></span></div><div class="small rik-source-line"><span id="resultsRikTotalRegistered">--</span> <span id="resultsRikSourceRegistered"></span></div>`;
        resultsCards.appendChild(card1);

        const card2 = document.createElement('div');
        card2.className = 'card';
        card2.innerHTML = `<h3>${locale.totalVotingPlaces || 'Total voting places'}</h3><div class="value summary-big"><span id="resultsTotalVotingPlaces">0</span> <span class="summary-percent" id="resultsTotalVotingPlacesPercent">(100.00%)</span></div><div class="small rik-source-line"><span id="resultsRikTotalVotingPlaces">--</span> <span id="resultsRikSourceVotingPlaces"></span></div>`;
        resultsCards.appendChild(card2);

        const card3 = document.createElement('div');
        card3.className = 'card';
        card3.innerHTML = `<h3>${locale.totalVoted || 'Total voters who turned out'}</h3><div class="value summary-big"><span id="resultsTotalCollected">0</span> <span class="summary-percent" id="resultsTotalPercent"></span></div><div class="duration-started-at turnout-breakdown-line"><span id="resultsTotalCollectedInPlaceLabel" class="started-label">${locale.turnoutInPlaceLabel || 'In Place:'}</span><span class="started-time" id="resultsTotalCollectedInPlace">0</span><span id="resultsTotalCollectedFromHomeLabel" class="started-label">${locale.turnoutFromHomeLabel || 'From Home:'}</span><span class="started-time" id="resultsTotalCollectedFromHome">0</span></div>`;
        resultsCards.appendChild(card3);

        const card4 = document.createElement('div');
        card4.className = 'card';
        card4.innerHTML = `<div id="resultsDurationDateCorner" class="duration-date-corner"></div><h3>${locale.duration || 'DURATION'}</h3><div id="resultsDurationClock" class="value">00:00:00</div><div id="resultsDurationStartedAt" class="duration-started-at duration-started-grid"><span class="started-label">--</span><span class="started-time">--:--:--</span></div>`;
        resultsCards.appendChild(card4);

        const card5 = document.createElement('div');
        card5.className = 'card';
        card5.innerHTML = `
          <h3>${locale.coverage || 'COVERAGE'}</h3>
          <div class="coverage-row">
            <span class="coverage-label coverage-registered">${locale.registeredControllers || 'Number of Registered Controllers'}</span>
            <span class="coverage-colon">:</span>
            <strong id="resultsRegisteredControllers">0</strong>
            <span class="coverage-percent" id="resultsRegisteredControllersPercent">(0.00%)</span>
          </div>
          <div class="coverage-row">
            <span class="coverage-label coverage-active">${locale.activeControllers || 'Number of Active Controllers'}</span>
            <span class="coverage-colon">:</span>
            <strong id="resultsActiveControllers">0</strong>
            <span class="coverage-percent" id="resultsActiveControllersPercent">(0.00%)</span>
          </div>
        `;
        resultsCards.appendChild(card5);
      }

      function buildResultsTree(config) {
        const container = document.getElementById('resultsTree');
        if (!container) return;
        const locale = getLocaleDictionary();
        const regions = getRegions(config);
        const candidates = getResultCandidates(config);
        const candidateIds = candidates.map((candidate) => String(candidate.id));

        globalThis.cleanupResultsTableViewport?.();
        container.innerHTML = '';

        const table = el('table');
        table.className = 'regions-table';
        const thead = el('thead');
        const candidateHeaderCells = candidates.map((candidate, index) => (
          `<th colspan="2" class="group-header candidate-group-header" data-results-candidate="${escapeHtml(candidate.id)}" style="color:${RESULT_CANDIDATE_COLORS[index % RESULT_CANDIDATE_COLORS.length]}" data-tooltip="${escapeHtml(candidate.name)}">${escapeHtml(candidate.alias)}</th>`
        )).join('');
        const candidateSubHeaders = candidates.map((candidate) => (
          `<th id="resultsHeaderCandidateNumber-${escapeHtml(candidate.id)}">${locale.tableTurnoutNumber || 'Number'}</th><th id="resultsHeaderCandidatePercent-${escapeHtml(candidate.id)}">${locale.tableTurnoutPercent || 'Percentage'}</th>`
        )).join('');
        const ballotGroupHeader = `<th id="resultsHeaderBallots" colspan="3" class="group-header">${locale.tableBallots || 'Ballots'}</th>`;
        const ballotSubHeaders = `<th id="resultsHeaderValid">${locale.tableBallotsValid || 'Valid'}</th><th id="resultsHeaderNonValid">${locale.tableBallotsNonValid || 'Non valid'}</th><th id="resultsHeaderRemaining">${locale.tableBallotsRemaining || 'Remaining'}</th>`;
        thead.innerHTML = `
          <tr class="results-header-group-row">
            <th id="resultsHeaderName" rowspan="2" style="width:30%">${locale.tableName || 'Name'}</th>
            <th id="resultsHeaderRegistered" rowspan="2" style="width:10%">${locale.tableRegistered || 'Registered'}</th>
            <th id="resultsHeaderVoted" colspan="3" class="group-header" style="width:22%">${locale.tableVoted || 'Voted'}</th>
            ${ballotGroupHeader}
            ${candidateHeaderCells}
            <th id="resultsHeaderControllerActivity" rowspan="2" style="width:10%">${locale.tableControllerActivity || 'Controller Activity'}</th>
          </tr>
          <tr class="results-header-label-row">
            <th id="resultsHeaderVotedInPlace">${locale.tableVotedInPlace || 'Voted in Place'}</th>
            <th id="resultsHeaderVotedFromHome">${locale.tableVotedFromHome || 'Voted from Home'}</th>
            <th id="resultsHeaderVotedTotal">${locale.tableVotedTotal || 'Total'}</th>
            ${ballotSubHeaders}
            ${candidateSubHeaders}
          </tr>`;
        table.appendChild(thead);

        const tbody = el('tbody');

        function activityCell(senderStatus) {
          const s = String(senderStatus ?? '0');
          const key = `controllerStatus${s}`;
          const label = locale[key] || locale.controllerStatus0 || 'Not Covered';
          return `<td><span class="ctrl-status ctrl-status-${s}">${label}</span></td>`;
        }

        function getBallotTotalsForResult(result, votedTotal = 0) {
          const nonValidValues = Array.isArray(result && result.nonValidVotes) ? result.nonValidVotes : [];
          const inferredNonValid = nonValidValues.reduce((sum, item) => sum + Number(item && item.votes || 0), 0);
          const nonValid = Number((result && result.nonRegularBallots) != null ? result.nonRegularBallots : inferredNonValid);
          const remaining = Number(result && result.remainingBallots || 0);
          const totalVoted = Number(votedTotal || 0);
          const valid = Math.max(totalVoted - nonValid, 0);
          return { valid, nonValid, remaining };
        }

        function ballotCells(rowKey, result, votedTotal = 0) {
          const totals = getBallotTotalsForResult(result, votedTotal);
          return `${numericCell(`<span id="results-ballot-valid-${rowKey}">${formatNumber(totals.valid)}</span>`)}${numericCell(`<span id="results-ballot-non-valid-${rowKey}">${formatNumber(totals.nonValid)}</span>`)}${numericCell(`<span id="results-ballot-remaining-${rowKey}">${formatNumber(totals.remaining)}</span>`)}`;
        }

        function hasBallotValidationMismatch(place) {
          if (getPlaceSenderStatusId(place) !== '6') return false;
          const votedInPlace = Number(place && (place.totalVoted || place.voted) || 0);
          const votedFromHome = Number(place && place.votedFromHome || 0);
          const totals = getBallotTotalsForResult(place && place.result, votedInPlace + votedFromHome);
          const registeredVoters = Number(place && place.registeredVoters || 0);
          return registeredVoters - (totals.valid + totals.nonValid + totals.remaining) !== 0;
        }

        function hasInvalidDescendant(node) {
          if (!node) return false;
          if (Array.isArray(node.places) && node.places.some((place) => hasBallotValidationMismatch(place) || hasInvalidDescendant(place))) return true;
          if (Array.isArray(node.subPlaces) && node.subPlaces.some((place) => hasBallotValidationMismatch(place) || hasInvalidDescendant(place))) return true;
          if (Array.isArray(node.municipalities) && node.municipalities.some(hasInvalidDescendant)) return true;
          return false;
        }

        function candidateCells(rowKey, candidateMap = new Map(), rowTotal = 0) {
          return candidates.map((candidate) => {
            const candidateId = String(candidate.id);
            const voteCount = Number(candidateMap.get(candidateId) || 0);
            const votePct = rowTotal > 0 ? (voteCount / rowTotal) * 100 : 0;
            return `${numericCell(`<span id="results-candidate-number-${candidateId}-${rowKey}">${formatNumber(voteCount)}</span>`)}${numericCell(`<span id="results-candidate-percent-${candidateId}-${rowKey}">${votePct.toFixed(2)}%</span>`)}`;
          }).join('');
        }

        function updateBallotCells(rowKey, result, votedTotal = 0) {
          const totals = getBallotTotalsForResult(result, votedTotal);
          const validEl = document.getElementById(`results-ballot-valid-${rowKey}`);
          const nonValidEl = document.getElementById(`results-ballot-non-valid-${rowKey}`);
          const remainingEl = document.getElementById(`results-ballot-remaining-${rowKey}`);
          if (validEl) validEl.textContent = formatNumber(totals.valid);
          if (nonValidEl) nonValidEl.textContent = formatNumber(totals.nonValid);
          if (remainingEl) remainingEl.textContent = formatNumber(totals.remaining);
        }

        function formatRegisteredWithRik(count, rikCount) {
          const value = Number(count || 0);
          const rikValue = rikCount != null && Number(rikCount) > 0 ? Number(rikCount) : null;
          if (rikValue == null) {
            return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span></span>`;
          }
          return `<span class="registered-count-stack"><span class="registered-count-main">${formatNumber(value)}</span><span class="registered-count-rik">${formatNumber(rikValue)} <span class="registered-count-source">${locale.rikSource || 'Source RIK'}</span></span></span>`;
        }

        function emptyCells(count) {
          return new Array(count).fill('<td></td>').join('');
        }

        // lazy-build helpers: only construct child rows the first time a node is expanded,
        // instead of building the full 8000+ row tree up front.
        function createPlaceRow(place, parentId) {
          const placeRow = el('tr');
          placeRow.className = `place-row hidden-row${hasBallotValidationMismatch(place) ? ' ballot-validation-error' : ''}`;
          placeRow.dataset.parent = parentId;
          placeRow.dataset.id = `results-place-${place.id}`;
          const votedInPlace = Number(place.totalVoted || place.voted || 0);
          const votedFromHome = Number(place.votedFromHome || 0);
          const votedTotal = votedInPlace + votedFromHome;
          const stats = getResultStats(place, candidateIds);
          placeRow.innerHTML = `<td>${place.name}</td><td class="numeric-cell"><span id="results-registered-place-${place.id}">${place.registeredVoters || 0}</span></td><td class="numeric-cell"><span id="results-voted-in-place-place-${place.id}">${formatNumber(votedInPlace)}</span></td><td class="numeric-cell"><span id="results-voted-from-home-place-${place.id}">${formatNumber(votedFromHome)}</span></td><td class="numeric-cell"><span id="results-voted-total-place-${place.id}">${formatNumber(votedTotal)}</span></td>${ballotCells(`place-${place.id}`, place.result, votedTotal)}${candidateCells(`place-${place.id}`, stats.votes, stats.total)}${activityCell(getPlaceSenderStatusId(place), `place-${place.id}`)}`;
          return placeRow;
        }

        function attachLazyToggle(row, buildChildren) {
          const btn = row.querySelector('.collapse-btn');
          if (!btn) return;
          btn.addEventListener('click', () => {
            const expanded = btn.dataset.expanded === '1';
            const show = !expanded;
            btn.dataset.expanded = show ? '1' : '0';
            btn.textContent = show ? '▼' : '▶';
            if (show && buildChildren && !row.dataset.built) {
              row.dataset.built = '1';
              const childRows = buildChildren() || [];
              if (childRows.length) row.after(...childRows);
            }
            toggleChildren(row.dataset.id, show);
          });
        }

        function createMunRow(region, mun) {
          const munId = `results-mun-${region.id}-${mun.id}`;
          const munRow = el('tr');
          munRow.className = `mun-row hidden-row${hasInvalidDescendant(mun) ? ' ballot-validation-error' : ''}`;
          munRow.dataset.parent = `results-region-${region.id}`;
          munRow.dataset.id = munId;
          const votedInPlace = Number(mun.totalVoted || mun.voted || 0);
          const votedFromHome = Number(mun.votedFromHome || 0);
          const votedTotal = votedInPlace + votedFromHome;
          const stats = getResultStats(mun, candidateIds);
          munRow.innerHTML = `<td><button class="collapse-btn" data-target="${munId}">▶</button> ${mun.name}</td><td class="numeric-cell" id="results-registered-mun-${region.id}-${mun.id}">${formatRegisteredWithRik(mun.totalMunicipalityRegisteredVoters, mun.RIK_totalMunicipalityRegisteredVoters)}</td><td class="numeric-cell"><span id="results-voted-in-place-mun-${region.id}-${mun.id}">${formatNumber(votedInPlace)}</span></td><td class="numeric-cell"><span id="results-voted-from-home-mun-${region.id}-${mun.id}">${formatNumber(votedFromHome)}</span></td><td class="numeric-cell"><span id="results-voted-total-mun-${region.id}-${mun.id}">${formatNumber(votedTotal)}</span></td>${ballotCells(`mun-${region.id}-${mun.id}`, mun.result, votedTotal)}${candidateCells(`mun-${region.id}-${mun.id}`, stats.votes, stats.total)}<td></td>`;
          attachLazyToggle(munRow, () => (mun.places || []).map((place) => createPlaceRow(place, munId)));
          return munRow;
        }

        function createPlaceGroupRow(region, place) {
          const groupId = `results-mun-${region.id}-${place.id}`;
          const parentRow = el('tr');
          parentRow.className = `mun-row hidden-row${hasInvalidDescendant(place) ? ' ballot-validation-error' : ''}`;
          parentRow.dataset.parent = `results-region-${region.id}`;
          parentRow.dataset.id = groupId;
          parentRow.innerHTML = `<td><button class="collapse-btn" data-target="${groupId}">▶</button> ${place.name}</td>${emptyCells(5 + 3 + (candidates.length * 2))}`;
          attachLazyToggle(parentRow, () => (place.subPlaces || []).map((sub) => createPlaceRow(sub, groupId)));
          return parentRow;
        }

        function createRegionRow(region) {
          const regionId = `results-region-${region.id}`;
          const regionRow = el('tr');
          regionRow.className = `region-row${hasInvalidDescendant(region) ? ' ballot-validation-error' : ''}`;
          regionRow.dataset.id = regionId;
          const votedInPlace = Number(region.totalVoted || region.voted || 0);
          const votedFromHome = Number(region.votedFromHome || 0);
          const votedTotal = votedInPlace + votedFromHome;
          const stats = getResultStats(region, candidateIds);
          regionRow.innerHTML = `<td><button class="collapse-btn" data-target="${regionId}">▶</button> <strong>${region.name}</strong></td><td class="numeric-cell" id="results-registered-region-${region.id}">${formatRegisteredWithRik(region.totalRegionRegisteredVoters, region.RIK_totalRegionRegisteredVoters)}</td><td class="numeric-cell"><span id="results-voted-in-place-region-${region.id}">${formatNumber(votedInPlace)}</span></td><td class="numeric-cell"><span id="results-voted-from-home-region-${region.id}">${formatNumber(votedFromHome)}</span></td><td class="numeric-cell"><span id="results-voted-total-region-${region.id}">${formatNumber(votedTotal)}</span></td>${ballotCells(`region-${region.id}`, region.result, votedTotal)}${candidateCells(`region-${region.id}`, stats.votes, stats.total)}<td></td>`;
          attachLazyToggle(regionRow, () => {
            const rows = [];
            if (Array.isArray(region.municipalities) && region.municipalities.length) {
              region.municipalities.forEach((mun) => rows.push(createMunRow(region, mun)));
            }
            if (Array.isArray(region.places) && region.places.length) {
              region.places.forEach((place) => {
                if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
                  rows.push(createPlaceGroupRow(region, place));
                } else {
                  rows.push(createPlaceRow(place, regionId));
                }
              });
            }
            return rows;
          });
          return regionRow;
        }

        regions.forEach((region) => {
          tbody.appendChild(createRegionRow(region));
        });

        table.appendChild(tbody);

        const headerDiv = el('div');
        headerDiv.className = 'table-header';
        headerDiv.innerHTML = `<button id="resultsPregledBtn" class="collapse-btn" data-expanded="1">▼</button> <strong id="resultsSummaryTitle">${locale.regionSummaryTitle || 'Data'}</strong>`;
        const tableScroll = document.createElement('div');
        tableScroll.className = 'results-table-scroll';
        tableScroll.appendChild(table);
        container.appendChild(headerDiv);
        const stickyHeaderViewport = document.createElement('div');
        stickyHeaderViewport.className = 'results-sticky-header-viewport';
        container.appendChild(tableScroll);

        const stickyHeaderTable = document.createElement('table');
        stickyHeaderTable.className = 'regions-table results-sticky-header-table';
        stickyHeaderTable.innerHTML = thead.outerHTML;
        stickyHeaderTable.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
        thead.style.visibility = 'hidden';
        stickyHeaderViewport.appendChild(stickyHeaderTable);
        container.insertBefore(stickyHeaderViewport, tableScroll);
        const syncStickyHeaderMetrics = () => {
          stickyHeaderTable.style.width = `${table.getBoundingClientRect().width}px`;
          stickyHeaderTable.style.transform = `translateX(${-tableScroll.scrollLeft}px)`;
          stickyHeaderTable.querySelectorAll('th').forEach((headerCell, index) => {
            const sourceCell = thead.querySelectorAll('th')[index];
            if (sourceCell) headerCell.style.width = `${sourceCell.getBoundingClientRect().width}px`;
          });
        };
        syncStickyHeaderMetrics();

        const bottomScrollbar = document.createElement('div');
        bottomScrollbar.id = 'resultsBottomScrollbar';
        bottomScrollbar.className = 'results-bottom-scrollbar';
        bottomScrollbar.innerHTML = '<div class="results-bottom-scrollbar-content"></div>';
        document.body.appendChild(bottomScrollbar);
        const bottomScrollbarContent = bottomScrollbar.firstElementChild;
        const mainScrollContainer = document.querySelector('.main');
        let syncingBottomScrollbar = false;
        const syncBottomScrollbarMetrics = () => {
          const rect = container.getBoundingClientRect();
          bottomScrollbar.style.left = `${Math.max(0, rect.left)}px`;
          bottomScrollbar.style.width = `${Math.max(0, window.innerWidth - Math.max(0, rect.left))}px`;
          const contentWidth = Math.max(tableScroll.scrollWidth, table.scrollWidth);
          bottomScrollbarContent.style.width = `${contentWidth}px`;
          bottomScrollbar.style.display = contentWidth > tableScroll.clientWidth ? 'block' : 'none';
          bottomScrollbar.scrollLeft = tableScroll.scrollLeft;
        };
        bottomScrollbar.addEventListener('scroll', () => {
          if (syncingBottomScrollbar) return;
          syncingBottomScrollbar = true;
          tableScroll.scrollLeft = bottomScrollbar.scrollLeft;
          syncingBottomScrollbar = false;
        });
        tableScroll.addEventListener('scroll', () => {
          if (syncingBottomScrollbar) return;
          syncingBottomScrollbar = true;
          bottomScrollbar.scrollLeft = tableScroll.scrollLeft;
          syncingBottomScrollbar = false;
        });
        const updateResultsTableStickyOffset = () => {
          const banner = document.querySelector('.page-banner');
          const bannerBottom = banner ? Math.max(0, banner.getBoundingClientRect().bottom) : 0;
          table.style.setProperty('--results-table-sticky-top', `${bannerBottom}px`);
          stickyHeaderViewport.style.setProperty('--results-table-sticky-top', `${bannerBottom}px`);
          const tableRect = tableScroll.getBoundingClientRect();
          const headerHeight = stickyHeaderViewport.offsetHeight;
          const shouldPin = tableRect.top <= bannerBottom && tableRect.bottom > bannerBottom + headerHeight;
          stickyHeaderViewport.classList.toggle('is-pinned', shouldPin);
          if (shouldPin) {
            stickyHeaderViewport.style.left = `${tableRect.left}px`;
            stickyHeaderViewport.style.width = `${tableScroll.clientWidth}px`;
          } else {
            stickyHeaderViewport.style.left = '';
            stickyHeaderViewport.style.width = '';
          }
          syncStickyHeaderMetrics();
          syncBottomScrollbarMetrics();
        };
        const resultsTableResizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(syncBottomScrollbarMetrics)
          : null;
        resultsTableResizeObserver?.observe(container);
        resultsTableResizeObserver?.observe(table);
        resultsTableResizeObserver?.observe(stickyHeaderTable);
        resultsTableResizeObserver?.observe(stickyHeaderViewport);
        globalThis.cleanupResultsTableViewport = () => {
          window.removeEventListener('resize', updateResultsTableStickyOffset);
          window.removeEventListener('scroll', updateResultsTableStickyOffset);
          mainScrollContainer?.removeEventListener('scroll', updateResultsTableStickyOffset);
          resultsTableResizeObserver?.disconnect();
          bottomScrollbar.remove();
          if (globalThis.cleanupResultsTableViewport) {
            delete globalThis.cleanupResultsTableViewport;
          }
        };
        window.addEventListener('resize', updateResultsTableStickyOffset);
        window.addEventListener('scroll', updateResultsTableStickyOffset, { passive: true });
        mainScrollContainer?.addEventListener('scroll', updateResultsTableStickyOffset, { passive: true });
        updateResultsTableStickyOffset();

        (function attachPregled() {
          const btn = container.querySelector('#resultsPregledBtn');
          const tbodyEl = table.querySelector('tbody');
          if (!btn || !tbodyEl) return;
          btn.addEventListener('click', () => {
            const expanded = btn.dataset.expanded === '1';
            const show = !expanded;
            btn.dataset.expanded = show ? '1' : '0';
            btn.textContent = show ? '▼' : '▶';
            tbodyEl.style.display = show ? '' : 'none';
          });
        })();

        function toggleChildren(parentId, show) {
          const directChildren = Array.from(container.querySelectorAll(`tr[data-parent="${parentId}"]`));
          directChildren.forEach((child) => {
            if (show) child.classList.remove('hidden-row'); else child.classList.add('hidden-row');
            if (!show) {
              const childBtn = child.querySelector('.collapse-btn');
              if (childBtn) { childBtn.dataset.expanded = '0'; childBtn.textContent = '▶'; }
              const childId = child.dataset.id;
              if (childId) toggleChildren(childId, false);
            } else {
              const childId = child.dataset.id;
              const childBtn = child.querySelector('.collapse-btn');
              if (childBtn && childBtn.dataset.expanded === '1' && childId) {
                toggleChildren(childId, true);
              }
            }
          });
        }

        globalThis.refreshResultsBallotValidation = () => {
          const findRow = (rowId) => Array.from(container.querySelectorAll('tr')).find((row) => row.dataset.id === rowId);
          const setRowState = (rowId, invalid) => {
            const row = findRow(rowId);
            if (row) row.classList.toggle('ballot-validation-error', invalid);
          };
          regions.forEach((region) => {
            setRowState(`results-region-${region.id}`, hasInvalidDescendant(region));
            (region.municipalities || []).forEach((mun) => {
              setRowState(`results-mun-${region.id}-${mun.id}`, hasInvalidDescendant(mun));
            });
            (region.places || []).forEach((place) => {
              const rowId = `results-mun-${region.id}-${place.id}`;
              setRowState(rowId, hasInvalidDescendant(place) || hasBallotValidationMismatch(place));
              (place.subPlaces || []).forEach((sub) => {
                setRowState(`results-place-${sub.id}`, hasBallotValidationMismatch(sub));
              });
              if (!Array.isArray(place.subPlaces) || place.subPlaces.length === 0) {
                setRowState(`results-place-${place.id}`, hasBallotValidationMismatch(place));
              }
            });
          });
        };
      }

      async function loadResultsSummary() {
        if (!cachedConfig) return;
      }

      function buildConfigTotals(config) {
        const totals = {
          totalCollected: 0,
          totalCollectedInPlace: 0,
          totalCollectedFromHome: 0,
          regionTotals: {},
          regionTotalsInPlace: {},
          regionTotalsFromHome: {},
          placeTotals: {},
          placeTotalsInPlace: {},
          placeTotalsFromHome: {},
          totalVotingPlaces: 0,
          registeredControllers: 0,
          activeControllers: 0
        };
        const regions = getRegions(config || {});
        const votingPlaces = collectVotingPlaces(config || {});
        totals.totalVotingPlaces = Number(config && (config.votingUnitsPlacesNumber || config.RIK_votingUnitsPlacesNumber || votingPlaces.length || 0));

        votingPlaces.forEach((place) => {
          const senders = getPlaceSenders(place);
          const hasDefinedController = senders.some((sender) => String((sender && sender.signalUser) || '').trim() !== 'TBD');
          const hasActiveController = hasDefinedController && String((place && place.senderStatus) || (senders[0] && senders[0].senderStatus) || '').trim() !== '0';
          if (hasDefinedController) totals.registeredControllers += 1;
          if (hasActiveController) totals.activeControllers += 1;
        });

        regions.forEach(region => {
          let regionTotal = 0;
          let regionTotalInPlace = 0;
          let regionTotalFromHome = 0;

          if (Array.isArray(region.municipalities)) {
            region.municipalities.forEach(mun => {
              (mun.places || []).forEach(place => {
                const valueInPlace = Number(place.totalVoted || place.voted || 0);
                const valueFromHome = Number(place.votedFromHome || 0);
                const valueTotal = valueInPlace + valueFromHome;
                totals.placeTotals[`${region.name} / ${place.name}`] = valueTotal;
                totals.placeTotalsInPlace[`${region.name} / ${place.name}`] = valueInPlace;
                totals.placeTotalsFromHome[`${region.name} / ${place.name}`] = valueFromHome;
                regionTotalInPlace += valueInPlace;
                regionTotalFromHome += valueFromHome;
                regionTotal += valueTotal;
              });
            });
          }

          if (Array.isArray(region.places)) {
            region.places.forEach(place => {
              if (Array.isArray(place.subPlaces)) {
                place.subPlaces.forEach(sub => {
                  const valueInPlace = Number(sub.totalVoted || sub.voted || 0);
                  const valueFromHome = Number(sub.votedFromHome || 0);
                  const valueTotal = valueInPlace + valueFromHome;
                  totals.placeTotals[`${region.name} / ${sub.name}`] = valueTotal;
                  totals.placeTotalsInPlace[`${region.name} / ${sub.name}`] = valueInPlace;
                  totals.placeTotalsFromHome[`${region.name} / ${sub.name}`] = valueFromHome;
                  regionTotalInPlace += valueInPlace;
                  regionTotalFromHome += valueFromHome;
                  regionTotal += valueTotal;
                });
              } else {
                const valueInPlace = Number(place.totalVoted || place.voted || 0);
                const valueFromHome = Number(place.votedFromHome || 0);
                const valueTotal = valueInPlace + valueFromHome;
                totals.placeTotals[`${region.name} / ${place.name}`] = valueTotal;
                totals.placeTotalsInPlace[`${region.name} / ${place.name}`] = valueInPlace;
                totals.placeTotalsFromHome[`${region.name} / ${place.name}`] = valueFromHome;
                regionTotalInPlace += valueInPlace;
                regionTotalFromHome += valueFromHome;
                regionTotal += valueTotal;
              }
            });
          }

          totals.regionTotals[region.name] = regionTotal;
          totals.regionTotalsInPlace[region.name] = regionTotalInPlace;
          totals.regionTotalsFromHome[region.name] = regionTotalFromHome;
          totals.totalCollectedInPlace += regionTotalInPlace;
          totals.totalCollectedFromHome += regionTotalFromHome;
          totals.totalCollected += regionTotal;
        });

        return totals;
      }

      async function loadSummary() {
        const showParliamentary = activeElectionFamily === 'parliamentary' && Boolean(activeParliamentaryPhase);
        updateParliamentaryViewVisibility();
        if (!showParliamentary) return;

        const configChangedWhileRunning = await refreshConfigFromVersionIfChanged();
        if (configChangedWhileRunning && stopwatchRunning && cachedConfig) {
          const statuses = Array.isArray(cachedConfig.senderStatuses) ? cachedConfig.senderStatuses : [];
          const regions = getRegions(cachedConfig);
          captureCoverageTimelineSnapshotFromConfig(statuses, regions);
        }

        globalThis.loadResultsSummary = async function loadResultsSummary() {
          if (!cachedConfig) return;

          const configTotals = buildConfigTotals(cachedConfig);
          const candidateDefinitions = getResultCandidates(cachedConfig);
          const candidateIds = candidateDefinitions.map((candidate) => String(candidate.id));
          const regions = getRegions(cachedConfig);

          let totalRegistered = 0;
          regions.forEach((region) => {
            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach((mun) => {
                (mun.places || []).forEach((place) => {
                  totalRegistered += Number(place.registeredVoters || 0);
                });
              });
            }
            if (Array.isArray(region.places)) {
              region.places.forEach((place) => {
                if (Array.isArray(place.subPlaces)) {
                  place.subPlaces.forEach((sub) => {
                    totalRegistered += Number(sub.registeredVoters || 0);
                  });
                } else {
                  totalRegistered += Number(place.registeredVoters || 0);
                }
              });
            }
          });

          const totalCollected = configTotals.totalCollected;
          const totalCollectedInPlace = configTotals.totalCollectedInPlace || 0;
          const totalCollectedFromHome = configTotals.totalCollectedFromHome || 0;
          const totalVotingPlaces = Number(configTotals.totalVotingPlaces || 0);

          const totalRegEl = document.getElementById('resultsTotalRegistered');
          const totalVotingPlacesEl = document.getElementById('resultsTotalVotingPlaces');
          const totalVotingPlacesPercentEl = document.getElementById('resultsTotalVotingPlacesPercent');
          const totalColEl = document.getElementById('resultsTotalCollected');
          const totalColInPlaceEl = document.getElementById('resultsTotalCollectedInPlace');
          const totalColFromHomeEl = document.getElementById('resultsTotalCollectedFromHome');
          const registeredControllersEl = document.getElementById('resultsRegisteredControllers');
          const activeControllersEl = document.getElementById('resultsActiveControllers');
          const registeredControllersPercentEl = document.getElementById('resultsRegisteredControllersPercent');
          const activeControllersPercentEl = document.getElementById('resultsActiveControllersPercent');
          const totalPctEl = document.getElementById('resultsTotalPercent');
          if (totalRegEl) totalRegEl.textContent = formatNumber(totalRegistered);

          const totalRegisteredPercentEl = document.getElementById('resultsTotalRegisteredPercent');
          if (totalRegisteredPercentEl) {
            const rikRef = cachedConfig && cachedConfig.RIK_totalRegisteredVoters;
            if (rikRef && Number(rikRef) > 0) {
              const pct = (Number(totalRegistered) / Number(rikRef)) * 100;
              totalRegisteredPercentEl.textContent = `(${pct.toFixed(2)}%)`;
            } else {
              totalRegisteredPercentEl.textContent = '';
            }
          }
          if (totalVotingPlacesEl) totalVotingPlacesEl.textContent = formatNumber(totalVotingPlaces);
          if (totalVotingPlacesPercentEl) {
            const rikRef = cachedConfig && cachedConfig.RIK_votingUnitsPlacesNumber;
            if (rikRef && Number(rikRef) > 0) {
              const pct = (Number(totalVotingPlaces) / Number(rikRef)) * 100;
              totalVotingPlacesPercentEl.textContent = `(${pct.toFixed(2)}%)`;
            } else {
              totalVotingPlacesPercentEl.textContent = '';
            }
          }
          if (totalColEl) totalColEl.textContent = formatNumber(totalCollected);
          if (totalColInPlaceEl) totalColInPlaceEl.textContent = formatNumber(totalCollectedInPlace);
          if (totalColFromHomeEl) totalColFromHomeEl.textContent = formatNumber(totalCollectedFromHome);
          if (registeredControllersEl) registeredControllersEl.textContent = formatNumber(configTotals.registeredControllers || 0);
          if (activeControllersEl) activeControllersEl.textContent = formatNumber(configTotals.activeControllers || 0);
          if (registeredControllersPercentEl) {
            const pct = totalVotingPlaces > 0 ? (Number(configTotals.registeredControllers || 0) / Number(totalVotingPlaces)) * 100 : 0;
            registeredControllersPercentEl.textContent = `(${pct.toFixed(2)}%)`;
          }
          if (activeControllersPercentEl) {
            const pct = totalVotingPlaces > 0 ? (Number(configTotals.activeControllers || 0) / Number(totalVotingPlaces)) * 100 : 0;
            activeControllersPercentEl.textContent = `(${pct.toFixed(2)}%)`;
          }
          if (totalPctEl) {
            const pct = totalRegistered > 0 ? (Number(totalCollected) / Number(totalRegistered)) * 100 : 0;
            totalPctEl.textContent = `(${pct.toFixed(2)}%)`;
          }

          const rikLocale = getLocaleDictionary();
          const rikSourceHtml = rikLocale.rikSource || 'Source RIK';
          const rikRegEl = document.getElementById('resultsRikTotalRegistered');
          const rikRegSrcEl = document.getElementById('resultsRikSourceRegistered');
          const rikPlacesEl = document.getElementById('resultsRikTotalVotingPlaces');
          const rikPlacesSrcEl = document.getElementById('resultsRikSourceVotingPlaces');
          if (rikRegEl) rikRegEl.textContent = cachedConfig && cachedConfig.RIK_totalRegisteredVoters != null
            ? formatNumber(cachedConfig.RIK_totalRegisteredVoters) : '--';
          if (rikRegSrcEl) rikRegSrcEl.innerHTML = rikSourceHtml;
          if (rikPlacesEl) rikPlacesEl.textContent = cachedConfig && cachedConfig.RIK_votingUnitsPlacesNumber != null
            ? formatNumber(cachedConfig.RIK_votingUnitsPlacesNumber) : '--';
          if (rikPlacesSrcEl) rikPlacesSrcEl.innerHTML = rikSourceHtml;

          const resultsChart = document.getElementById('resultsRegionChart');
          const resultsRows = document.getElementById('resultsRegionChartRows');
          if (resultsChart && resultsRows) {
            const resultsRegionSelect = document.getElementById('resultsRegionSelect');
            if (resultsRegionSelect) {
              const options = ['<option value="ALL">ALL</option>'].concat(regions.map((region) => `<option value="${escapeHtml(region.id)}">${escapeHtml(region.name)}</option>`));
              if (resultsRegionSelect.innerHTML !== options.join('')) resultsRegionSelect.innerHTML = options.join('');
              resultsRegionSelect.value = selectedResultsRegionId;
              if (!resultsRegionSelect.dataset.bound) {
                resultsRegionSelect.dataset.bound = '1';
                resultsRegionSelect.addEventListener('change', () => {
                  selectedResultsRegionId = resultsRegionSelect.value || 'ALL';
                  globalThis.loadResultsSummary?.();
                });
              }
            }

            const selectedScope = selectedResultsRegionId === 'ALL'
              ? cachedConfig
              : regions.find((region) => String(region.id) === String(selectedResultsRegionId));
            const candidateTotals = new Map(candidateIds.map((candidateId) => [candidateId, 0]));
            const scopeCandidateVotes = selectedScope && selectedScope.result && Array.isArray(selectedScope.result.candidateVotes)
              ? selectedScope.result.candidateVotes
              : [];
            const scopeCandidateTotal = scopeCandidateVotes.reduce((total, candidate) => total + Number(candidate.votes || 0), 0);
            if (scopeCandidateVotes.length && scopeCandidateTotal > 0) {
              scopeCandidateVotes.forEach((candidate) => {
                if (candidateTotals.has(String(candidate.id))) candidateTotals.set(String(candidate.id), Number(candidate.votes || 0));
              });
            } else {
              const addPlaceResults = (place) => {
                sumVoteMap(candidateTotals, getResultStats(place, candidateIds).votes);
              };
              (selectedScope ? [selectedScope] : regions).forEach((region) => {
                (region.municipalities || []).forEach((mun) => (mun.places || []).forEach(addPlaceResults));
                (region.places || []).forEach((place) => {
                  if (Array.isArray(place.subPlaces) && place.subPlaces.length) place.subPlaces.forEach(addPlaceResults);
                  else addPlaceResults(place);
                });
              });
            }

            const totalCandidateVotes = candidateIds.reduce(
              (total, candidateId) => total + Number(candidateTotals.get(candidateId) || 0),
              0
            );
            const highestCandidateVotes = Math.max(...candidateIds.map((candidateId) => Number(candidateTotals.get(candidateId) || 0)), 0);
            const candidateColors = RESULT_CANDIDATE_COLORS;
            let pieStart = 0;
            const pieStops = [];
            const candidateRows = candidateDefinitions.map((candidate, index) => {
              const votes = Number(candidateTotals.get(String(candidate.id)) || 0);
              const pct = totalCandidateVotes > 0 ? (votes / totalCandidateVotes) * 100 : 0;
              const color = candidateColors[index % candidateColors.length];
              const pieEnd = pieStart + pct;
              pieStops.push(`${color} ${pieStart}% ${pieEnd}%`);
              pieStart = pieEnd;
              return `
                <div class="candidate-result-row">
                  <div class="candidate-result-name"><span class="candidate-order-number" style="background:${color}">${index + 1}</span><strong style="color:${color}" data-tooltip="${escapeHtml(candidate.name)}">${escapeHtml(candidate.alias)}</strong></div>
                  <div class="candidate-result-bar"><div class="candidate-result-fill" style="width:${highestCandidateVotes > 0 ? Math.min(100, (votes / highestCandidateVotes) * 100) : 0}%; background:${color}"></div></div>
                  <div class="candidate-result-meta"><strong>${formatNumber(votes)}</strong><span>${pct.toFixed(2)}%</span></div>
                </div>`;
            }).join('');
            const pieCandidates = candidateDefinitions.filter((candidate) => Number(candidateTotals.get(String(candidate.id)) || 0) > 0);
            let pieStartForVisibleCandidates = 0;
            const visiblePieStops = pieCandidates.map((candidate) => {
              const index = candidateDefinitions.indexOf(candidate);
              const votes = Number(candidateTotals.get(String(candidate.id)) || 0);
              const pct = totalCandidateVotes > 0 ? (votes / totalCandidateVotes) * 100 : 0;
              const pieEnd = pieStartForVisibleCandidates + pct;
              const stop = `${candidateColors[index % candidateColors.length]} ${pieStartForVisibleCandidates}% ${pieEnd}%`;
              pieStartForVisibleCandidates = pieEnd;
              return stop;
            });
            const pieHasVotes = pieCandidates.length > 0;
            let pieLabelStart = 0;
            const pieSliceRanges = [];
            const pieLabels = pieCandidates.map((candidate) => {
              const votes = Number(candidateTotals.get(String(candidate.id)) || 0);
              const pct = totalCandidateVotes > 0 ? (votes / totalCandidateVotes) * 100 : 0;
              const midpoint = pieLabelStart + (pct / 2);
              const angle = (midpoint / 100) * Math.PI * 2 - (Math.PI / 2);
              const radius = 36;
              const x = 50 + Math.cos(angle) * radius;
              const y = 50 + Math.sin(angle) * radius;
              pieSliceRanges.push({ start: pieLabelStart, end: pieLabelStart + pct, name: candidate.name });
              pieLabelStart += pct;
              return `<span class="candidate-results-pie-label" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-tooltip="${escapeHtml(candidate.name)}">${escapeHtml(candidate.alias)}<small>${pct.toFixed(2)}%</small></span>`;
            }).join('');
            resultsRows.innerHTML = `
              <div class="candidate-results-layout">
                <div class="candidate-results-bars">${candidateRows}</div>
                <div class="candidate-results-splitter" role="separator" aria-label="Resize chart columns" tabindex="0"></div>
                <div class="candidate-results-pie-panel">
                  <div class="candidate-results-pie${pieHasVotes ? '' : ' empty'}"${pieHasVotes ? ` style="background: conic-gradient(${visiblePieStops.join(', ')})"` : ''} aria-label="Candidate results by percentage">${pieHasVotes ? pieLabels : '<span>0.00%</span>'}</div>
                </div>
              </div>`;
            const chartLayout = resultsRows.querySelector('.candidate-results-layout');
            const splitter = resultsRows.querySelector('.candidate-results-splitter');
            const pieEl = resultsRows.querySelector('.candidate-results-pie');
            if (pieEl && pieHasVotes) {
              pieEl.addEventListener('pointermove', (event) => {
                const rect = pieEl.getBoundingClientRect();
                const dx = event.clientX - rect.left - rect.width / 2;
                const dy = event.clientY - rect.top - rect.height / 2;
                const radius = Math.min(rect.width, rect.height) / 2;
                if (Math.sqrt((dx * dx) + (dy * dy)) > radius) {
                  hideHoverTooltip();
                  return;
                }
                let angle = Math.atan2(dy, dx) + (Math.PI / 2);
                if (angle < 0) angle += Math.PI * 2;
                const pct = (angle / (Math.PI * 2)) * 100;
                const slice = pieSliceRanges.find((range) => pct >= range.start && pct < range.end) || pieSliceRanges[pieSliceRanges.length - 1];
                if (slice) {
                  hoverTooltip.textContent = slice.name;
                  positionHoverTooltip(event);
                  hoverTooltip.classList.add('visible');
                }
              });
              pieEl.addEventListener('pointerleave', hideHoverTooltip);
            }
            const applyChartSplit = () => {
              if (chartLayout) chartLayout.style.gridTemplateColumns = `${resultsChartSplitRatio}fr 8px ${1 - resultsChartSplitRatio}fr`;
            };
            applyChartSplit();
            if (chartLayout && splitter) {
              splitter.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                splitter.setPointerCapture(event.pointerId);
                const updateSplit = (moveEvent) => {
                  const bounds = chartLayout.getBoundingClientRect();
                  const ratio = (moveEvent.clientX - bounds.left) / bounds.width;
                  resultsChartSplitRatio = Math.max(0.2, Math.min(0.8, ratio));
                  applyChartSplit();
                };
                const stopSplit = () => {
                  splitter.removeEventListener('pointermove', updateSplit);
                  splitter.removeEventListener('pointerup', stopSplit);
                  splitter.removeEventListener('pointercancel', stopSplit);
                };
                splitter.addEventListener('pointermove', updateSplit);
                splitter.addEventListener('pointerup', stopSplit);
                splitter.addEventListener('pointercancel', stopSplit);
              });
            }
            resultsChart.style.display = '';
          }

          const candidateVotesByRegion = new Map();
          const candidateVotesByMun = new Map();

          function candidateMapForRow(stats) {
            return stats && stats.votes ? stats.votes : new Map();
          }

          function updateCandidateCells(rowKey, prefix, candidateMap, rowTotal) {
            candidateIds.forEach((candidateId) => {
              const voteCount = Number(candidateMap.get(candidateId) || 0);
              const votePct = rowTotal > 0 ? (voteCount / rowTotal) * 100 : 0;
              const numEl = document.getElementById(`${prefix}-candidate-number-${candidateId}-${rowKey}`);
              const pctEl = document.getElementById(`${prefix}-candidate-percent-${candidateId}-${rowKey}`);
              if (numEl) numEl.textContent = formatNumber(voteCount);
              if (pctEl) pctEl.textContent = `${votePct.toFixed(2)}%`;
            });
          }

          function updateActivityCell(rowKey, place) {
            const statusId = getPlaceSenderStatusId(place);
            const statusEl = document.getElementById(`results-activity-${rowKey}`);
            if (!statusEl) return;
            const statusLabel = locale[`controllerStatus${statusId}`] || locale.controllerStatus0 || 'Not Covered';
            statusEl.className = `ctrl-status ctrl-status-${statusId}`;
            statusEl.textContent = statusLabel;
          }

          function updateRowBallotCells(rowKey, result, votedTotal = 0) {
            const totals = getBallotTotalsForResult(result, votedTotal);
            const validEl = document.getElementById(`results-ballot-valid-${rowKey}`);
            const nonValidEl = document.getElementById(`results-ballot-non-valid-${rowKey}`);
            const remainingEl = document.getElementById(`results-ballot-remaining-${rowKey}`);
            if (validEl) validEl.textContent = formatNumber(totals.valid);
            if (nonValidEl) nonValidEl.textContent = formatNumber(totals.nonValid);
            if (remainingEl) remainingEl.textContent = formatNumber(totals.remaining);
          }

          regions.forEach((region) => {
            let regionRegisteredSum = 0;
            let regionCollectedInPlaceSum = 0;
            let regionCollectedFromHomeSum = 0;
            let regionResultSum = 0;
            const regionCandidateTotals = new Map(candidateIds.map((candidateId) => [candidateId, 0]));

            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach((mun) => {
                let munReg = 0;
                let munCollectedInPlace = 0;
                let munCollectedFromHome = 0;
                let munResultSum = 0;
                const munCandidateTotals = new Map(candidateIds.map((candidateId) => [candidateId, 0]));

                (mun.places || []).forEach((place) => {
                  const regCount = Number(place.registeredVoters || 0);
                  munReg += regCount;
                  regionRegisteredSum += regCount;
                  const collectedInPlace = Number(place.totalVoted || place.voted || 0);
                  const collectedFromHome = Number(place.votedFromHome || 0);
                  munCollectedInPlace += collectedInPlace;
                  munCollectedFromHome += collectedFromHome;
                  regionCollectedInPlaceSum += collectedInPlace;
                  regionCollectedFromHomeSum += collectedFromHome;

                  const stats = getResultStats(place, candidateIds);
                  munResultSum += stats.total;
                  regionResultSum += stats.total;
                  sumVoteMap(munCandidateTotals, stats.votes);
                  sumVoteMap(regionCandidateTotals, stats.votes);

                  const regEl = document.getElementById(`results-registered-place-${place.id}`);
                  const colInPlaceEl = document.getElementById(`results-voted-in-place-place-${place.id}`);
                  const colFromHomeEl = document.getElementById(`results-voted-from-home-place-${place.id}`);
                  const colTotalEl = document.getElementById(`results-voted-total-place-${place.id}`);
                  if (regEl) regEl.textContent = formatNumber(regCount);
                  if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                  if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                  if (colTotalEl) colTotalEl.textContent = formatNumber(collectedInPlace + collectedFromHome);
                  updateRowBallotCells(`place-${place.id}`, place.result, collectedInPlace + collectedFromHome);
                  updateCandidateCells(`place-${place.id}`, 'results', stats.votes, stats.total);
                  updateActivityCell(`place-${place.id}`, place);
                });

                const munRegEl = document.getElementById(`results-registered-mun-${region.id}-${mun.id}`);
                const munInPlaceEl = document.getElementById(`results-voted-in-place-mun-${region.id}-${mun.id}`);
                const munFromHomeEl = document.getElementById(`results-voted-from-home-mun-${region.id}-${mun.id}`);
                const munTotalEl = document.getElementById(`results-voted-total-mun-${region.id}-${mun.id}`);
                if (munRegEl) munRegEl.innerHTML = formatRegisteredWithRik(munReg, mun.RIK_totalMunicipalityRegisteredVoters);
                if (munInPlaceEl) munInPlaceEl.textContent = formatNumber(munCollectedInPlace);
                if (munFromHomeEl) munFromHomeEl.textContent = formatNumber(munCollectedFromHome);
                if (munTotalEl) munTotalEl.textContent = formatNumber(munCollectedInPlace + munCollectedFromHome);
                updateRowBallotCells(`mun-${region.id}-${mun.id}`, mun.result, munCollectedInPlace + munCollectedFromHome);
                updateCandidateCells(`mun-${region.id}-${mun.id}`, 'results', munCandidateTotals, munResultSum);
              });
            }

            if (Array.isArray(region.places)) {
              region.places.forEach((place) => {
                if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
                  const parentCandidateTotals = new Map(candidateIds.map((candidateId) => [candidateId, 0]));
                  let parentResultSum = 0;
                  place.subPlaces.forEach((sub) => {
                    const regCount = Number(sub.registeredVoters || 0);
                    regionRegisteredSum += regCount;
                    const collectedInPlace = Number(sub.totalVoted || sub.voted || 0);
                    const collectedFromHome = Number(sub.votedFromHome || 0);
                    regionCollectedInPlaceSum += collectedInPlace;
                    regionCollectedFromHomeSum += collectedFromHome;
                    const stats = getResultStats(sub, candidateIds);
                    parentResultSum += stats.total;
                    regionResultSum += stats.total;
                    sumVoteMap(parentCandidateTotals, stats.votes);
                    sumVoteMap(regionCandidateTotals, stats.votes);

                    const regEl = document.getElementById(`results-registered-place-${sub.id}`);
                    const colInPlaceEl = document.getElementById(`results-voted-in-place-place-${sub.id}`);
                    const colFromHomeEl = document.getElementById(`results-voted-from-home-place-${sub.id}`);
                    const colTotalEl = document.getElementById(`results-voted-total-place-${sub.id}`);
                    if (regEl) regEl.textContent = formatNumber(regCount);
                    if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                    if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                    if (colTotalEl) colTotalEl.textContent = formatNumber(collectedInPlace + collectedFromHome);
                    updateRowBallotCells(`place-${sub.id}`, sub.result, collectedInPlace + collectedFromHome);
                    updateCandidateCells(`place-${sub.id}`, 'results', stats.votes, stats.total);
                    updateActivityCell(`place-${sub.id}`, sub);
                  });
                  updateRowBallotCells(`mun-${region.id}-${place.id}`, place.result, (place.totalVoted || place.voted || 0) + Number(place.votedFromHome || 0));
                  updateCandidateCells(`mun-${region.id}-${place.id}`, 'results', parentCandidateTotals, parentResultSum);
                } else {
                  const regCount = Number(place.registeredVoters || 0);
                  regionRegisteredSum += regCount;
                  const collectedInPlace = Number(place.totalVoted || place.voted || 0);
                  const collectedFromHome = Number(place.votedFromHome || 0);
                  regionCollectedInPlaceSum += collectedInPlace;
                  regionCollectedFromHomeSum += collectedFromHome;
                  const stats = getResultStats(place, candidateIds);
                  regionResultSum += stats.total;
                  sumVoteMap(regionCandidateTotals, stats.votes);

                  const regEl = document.getElementById(`results-registered-place-${place.id}`);
                  const colInPlaceEl = document.getElementById(`results-voted-in-place-place-${place.id}`);
                  const colFromHomeEl = document.getElementById(`results-voted-from-home-place-${place.id}`);
                  const colTotalEl = document.getElementById(`results-voted-total-place-${place.id}`);
                  if (regEl) regEl.textContent = formatNumber(regCount);
                  if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                  if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                  if (colTotalEl) colTotalEl.textContent = formatNumber(collectedInPlace + collectedFromHome);
                  updateRowBallotCells(`place-${place.id}`, place.result, collectedInPlace + collectedFromHome);
                  updateCandidateCells(`place-${place.id}`, 'results', stats.votes, stats.total);
                  updateActivityCell(`place-${place.id}`, place);
                }
              });
            }

            const regionRegEl = document.getElementById(`results-registered-region-${region.id}`);
            const regionInPlaceEl = document.getElementById(`results-voted-in-place-region-${region.id}`);
            const regionFromHomeEl = document.getElementById(`results-voted-from-home-region-${region.id}`);
            const regionTotalEl = document.getElementById(`results-voted-total-region-${region.id}`);
            if (regionRegEl) regionRegEl.innerHTML = formatRegisteredWithRik(regionRegisteredSum, region.RIK_totalRegionRegisteredVoters);
            if (regionInPlaceEl) regionInPlaceEl.textContent = formatNumber(regionCollectedInPlaceSum);
            if (regionFromHomeEl) regionFromHomeEl.textContent = formatNumber(regionCollectedFromHomeSum);
            if (regionTotalEl) regionTotalEl.textContent = formatNumber(regionCollectedInPlaceSum + regionCollectedFromHomeSum);
            updateRowBallotCells(`region-${region.id}`, region.result, regionCollectedInPlaceSum + regionCollectedFromHomeSum);
            updateCandidateCells(`region-${region.id}`, 'results', regionCandidateTotals, regionResultSum);
          });
          globalThis.refreshResultsBallotValidation?.();
        }

        const summaryResponse = await fetch('/api/summary');
        const summary = await summaryResponse.json();
        const configTotals = buildConfigTotals(cachedConfig);
        const sidebarLastUpdated = document.getElementById('sidebarLastUpdated');
        if (sidebarLastUpdated) {
          sidebarLastUpdated.textContent = 'Last updated: ' + new Date().toLocaleTimeString('en-GB', { hour12: false });
        }

        let totalRegistered = 0;
        const totalVotingPlaces = Number(configTotals.totalVotingPlaces || 0);
        const regions = getRegions(cachedConfig);
        if (regions.length) {
          regions.forEach(region => {
            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach(mun => {
                (mun.places || []).forEach(place => { totalRegistered += Number(place.registeredVoters || 0); });
              });
            }
            if (Array.isArray(region.places)) {
              region.places.forEach(place => {
                if (Array.isArray(place.subPlaces)) {
                  place.subPlaces.forEach(sub => { totalRegistered += Number(sub.registeredVoters || 0); });
                } else {
                  totalRegistered += Number(place.registeredVoters || 0);
                }
              });
            }
          });
        }
        const totalCollected = configTotals.totalCollected;
        const totalCollectedInPlace = configTotals.totalCollectedInPlace || 0;
        const totalCollectedFromHome = configTotals.totalCollectedFromHome || 0;
        const totalRegEl = document.getElementById('totalRegistered');
        const totalVotingPlacesEl = document.getElementById('totalVotingPlaces');
        const totalVotingPlacesPercentEl = document.getElementById('totalVotingPlacesPercent');
        const totalColEl = document.getElementById('totalCollected');
        const totalColInPlaceEl = document.getElementById('totalCollectedInPlace');
        const totalColFromHomeEl = document.getElementById('totalCollectedFromHome');
        const registeredControllersEl = document.getElementById('registeredControllers');
        const activeControllersEl = document.getElementById('activeControllers');
        const registeredControllersPercentEl = document.getElementById('registeredControllersPercent');
        const activeControllersPercentEl = document.getElementById('activeControllersPercent');
        const totalPctEl = document.getElementById('totalPercent');
        if (totalRegEl) totalRegEl.textContent = formatNumber(totalRegistered);
        const totalRegisteredPercentEl = document.getElementById('totalRegisteredPercent');
        if (totalRegisteredPercentEl) {
          const rikRef = cachedConfig && cachedConfig.RIK_totalRegisteredVoters;
          if (rikRef && Number(rikRef) > 0) {
            const pct = (Number(totalRegistered) / Number(rikRef)) * 100;
            totalRegisteredPercentEl.textContent = `(${pct.toFixed(2)}%)`;
          } else {
            totalRegisteredPercentEl.textContent = '';
          }
        }
        if (totalVotingPlacesEl) totalVotingPlacesEl.textContent = formatNumber(totalVotingPlaces);
        if (totalVotingPlacesPercentEl) {
          const rikRef = cachedConfig && cachedConfig.RIK_votingUnitsPlacesNumber;
          if (rikRef && Number(rikRef) > 0) {
            const pct = (Number(totalVotingPlaces) / Number(rikRef)) * 100;
            totalVotingPlacesPercentEl.textContent = `(${pct.toFixed(2)}%)`;
          } else {
            totalVotingPlacesPercentEl.textContent = '';
          }
        }
        if (totalColEl) totalColEl.textContent = formatNumber(totalCollected);
        if (totalColInPlaceEl) totalColInPlaceEl.textContent = formatNumber(totalCollectedInPlace);
        if (totalColFromHomeEl) totalColFromHomeEl.textContent = formatNumber(totalCollectedFromHome);
        if (registeredControllersEl) registeredControllersEl.textContent = formatNumber(configTotals.registeredControllers || 0);
        if (activeControllersEl) activeControllersEl.textContent = formatNumber(configTotals.activeControllers || 0);
        if (registeredControllersPercentEl) {
          const pct = totalVotingPlaces > 0 ? (Number(configTotals.registeredControllers || 0) / Number(totalVotingPlaces)) * 100 : 0;
          registeredControllersPercentEl.textContent = `(${pct.toFixed(2)}%)`;
        }
        if (activeControllersPercentEl) {
          const pct = totalVotingPlaces > 0 ? (Number(configTotals.activeControllers || 0) / Number(totalVotingPlaces)) * 100 : 0;
          activeControllersPercentEl.textContent = `(${pct.toFixed(2)}%)`;
        }
        if (totalPctEl) {
          const pct = totalRegistered > 0 ? (Number(totalCollected) / Number(totalRegistered)) * 100 : 0;
          totalPctEl.textContent = `(${pct.toFixed(2)}%)`;
        }

        // RIK reference values
        const rikLocale = getLocaleDictionary();
        const rikSourceHtml = rikLocale.rikSource || 'Source RIK';
        const rikRegEl = document.getElementById('rikTotalRegistered');
        const rikRegSrcEl = document.getElementById('rikSourceRegistered');
        const rikPlacesEl = document.getElementById('rikTotalVotingPlaces');
        const rikPlacesSrcEl = document.getElementById('rikSourceVotingPlaces');
        if (rikRegEl) rikRegEl.textContent = cachedConfig && cachedConfig.RIK_totalRegisteredVoters != null
          ? formatNumber(cachedConfig.RIK_totalRegisteredVoters) : '--';
        if (rikRegSrcEl) rikRegSrcEl.innerHTML = rikSourceHtml;
        if (rikPlacesEl) rikPlacesEl.textContent = cachedConfig && cachedConfig.RIK_votingUnitsPlacesNumber != null
          ? formatNumber(cachedConfig.RIK_votingUnitsPlacesNumber) : '--';
        if (rikPlacesSrcEl) rikPlacesSrcEl.innerHTML = rikSourceHtml;

        const placeCollected = configTotals.placeTotals || {};
        const placeCollectedInPlace = configTotals.placeTotalsInPlace || {};
        const placeCollectedFromHome = configTotals.placeTotalsFromHome || {};
        function getCollected(regionName, placeName) { return placeCollected[`${regionName} / ${placeName}`] || 0; }
        function getCollectedInPlace(regionName, placeName) { return placeCollectedInPlace[`${regionName} / ${placeName}`] || 0; }
        function getCollectedFromHome(regionName, placeName) { return placeCollectedFromHome[`${regionName} / ${placeName}`] || 0; }

        function renderRegionChart() {
          const chart = document.getElementById('regionChart');
          const rows = document.getElementById('regionChartRows');
          if (!chart || !rows || !cachedConfig) return;
          rows.innerHTML = '';
          const regionTotals = configTotals.regionTotals || {};
          getRegions(cachedConfig).forEach(region => {
            // compute registered for region (same logic as above)
            let regSum = 0;
            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach(mun => { (mun.places || []).forEach(place => { regSum += Number(place.registeredVoters || 0); }); });
            }
            if (Array.isArray(region.places)) {
              region.places.forEach(place => {
                if (Array.isArray(place.subPlaces)) {
                  place.subPlaces.forEach(sub => { regSum += Number(sub.registeredVoters || 0); });
                } else { regSum += Number(place.registeredVoters || 0); }
              });
            }
            const collected = Number(regionTotals[region.name] || 0);
            const pct = regSum > 0 ? (collected / regSum) * 100 : 0;

            const row = el('div', 'region-row-chart');
            row.innerHTML = `
              <div class="region-label">${region.name}</div>
              <div class="bar"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>
              <div class="meta">${formatNumber(collected)} / ${formatNumber(regSum)} (${pct.toFixed(2)}%)</div>
            `;
            rows.appendChild(row);
          });
          chart.style.display = '';
        }

        // call it now
        renderRegionChart();
        if (configChangedWhileRunning) {
          renderCoverageStatusPanel();
        }

        // Update tree counts: per-place, per-municipality, per-region
        const regionsForSummary = getRegions(cachedConfig);
        if (regionsForSummary.length) {
          regionsForSummary.forEach(region => {
            let regionRegisteredSum = 0;
            let regionCollectedInPlaceSum = 0;
            let regionCollectedFromHomeSum = 0;
            let regionCollectedSum = 0;

            // municipalities
            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach(mun => {
                let munReg = 0;
                let munCollectedInPlace = 0;
                let munCollectedFromHome = 0;
                let munCollected = 0;
                (mun.places || []).forEach(place => {
                  const regCount = Number(place.registeredVoters || 0);
                  munReg += regCount;
                  regionRegisteredSum += regCount;
                  const collectedInPlace = Number(place.totalVoted || place.voted || 0);
                  const collectedFromHome = Number(place.votedFromHome || 0);
                  const collected = collectedInPlace + collectedFromHome;
                  munCollectedInPlace += collectedInPlace;
                  munCollectedFromHome += collectedFromHome;
                  munCollected += collected;
                  regionCollectedInPlaceSum += collectedInPlace;
                  regionCollectedFromHomeSum += collectedFromHome;
                  regionCollectedSum += collected;
                  // update place DOM
                  const regEl = document.getElementById(`place-registered-${place.id}`);
                  const colInPlaceEl = document.getElementById(`place-in-place-${place.id}`);
                  const colFromHomeEl = document.getElementById(`place-from-home-${place.id}`);
                  const colEl = document.getElementById(`place-total-${place.id}`);
                  const pctEl = document.getElementById(`place-percent-${place.id}`);
                  if (regEl) regEl.textContent = formatNumber(regCount);
                  if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                  if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                  if (colEl) colEl.textContent = formatNumber(collected);
                  if (pctEl) {
                    const pct = regCount > 0 ? (Number(collected) / Number(regCount)) * 100 : 0;
                    pctEl.textContent = `${pct.toFixed(2)}%`;
                  }
                });
                const munRegEl = document.getElementById(`mun-registered-${region.id}-${mun.id}`);
                const munInPlaceEl = document.getElementById(`mun-in-place-${region.id}-${mun.id}`);
                const munFromHomeEl = document.getElementById(`mun-from-home-${region.id}-${mun.id}`);
                const munColEl = document.getElementById(`mun-total-${region.id}-${mun.id}`);
                const munPctEl = document.getElementById(`mun-percent-${region.id}-${mun.id}`);
                if (munRegEl) munRegEl.innerHTML = formatRegisteredWithRik(munReg, mun.RIK_totalMunicipalityRegisteredVoters);
                if (munInPlaceEl) munInPlaceEl.textContent = formatNumber(munCollectedInPlace);
                if (munFromHomeEl) munFromHomeEl.textContent = formatNumber(munCollectedFromHome);
                if (munColEl) munColEl.textContent = formatNumber(munCollected);
                if (munPctEl) {
                  const pct = munReg > 0 ? (Number(munCollected) / Number(munReg)) * 100 : 0;
                  munPctEl.textContent = `${pct.toFixed(2)}%`;
                }
              });
            }

            // direct places
            if (Array.isArray(region.places)) {
              region.places.forEach(place => {
                if (Array.isArray(place.subPlaces)) {
                  // parent with subPlaces
                  place.subPlaces.forEach(sub => {
                    const regCount = Number(sub.registeredVoters || 0);
                    regionRegisteredSum += regCount;
                    const collectedInPlace = Number(sub.totalVoted || sub.voted || 0);
                    const collectedFromHome = Number(sub.votedFromHome || 0);
                    const collected = collectedInPlace + collectedFromHome;
                    regionCollectedInPlaceSum += collectedInPlace;
                    regionCollectedFromHomeSum += collectedFromHome;
                    regionCollectedSum += collected;
                    const regEl = document.getElementById(`place-registered-${sub.id}`);
                    const colInPlaceEl = document.getElementById(`place-in-place-${sub.id}`);
                    const colFromHomeEl = document.getElementById(`place-from-home-${sub.id}`);
                    const colEl = document.getElementById(`place-total-${sub.id}`);
                    const pctEl = document.getElementById(`place-percent-${sub.id}`);
                    if (regEl) regEl.textContent = formatNumber(regCount);
                    if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                    if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                    if (colEl) colEl.textContent = formatNumber(collected);
                    if (pctEl) {
                      const pct = regCount > 0 ? (Number(collected) / Number(regCount)) * 100 : 0;
                      pctEl.textContent = `${pct.toFixed(2)}%`;
                    }
                  });
                } else {
                  const regCount = Number(place.registeredVoters || 0);
                  regionRegisteredSum += regCount;
                  const collectedInPlace = Number(place.totalVoted || place.voted || 0);
                  const collectedFromHome = Number(place.votedFromHome || 0);
                  const collected = collectedInPlace + collectedFromHome;
                  regionCollectedInPlaceSum += collectedInPlace;
                  regionCollectedFromHomeSum += collectedFromHome;
                  regionCollectedSum += collected;
                  const regEl = document.getElementById(`place-registered-${place.id}`);
                  const colInPlaceEl = document.getElementById(`place-in-place-${place.id}`);
                  const colFromHomeEl = document.getElementById(`place-from-home-${place.id}`);
                  const colEl = document.getElementById(`place-total-${place.id}`);
                  const pctEl = document.getElementById(`place-percent-${place.id}`);
                  if (regEl) regEl.textContent = formatNumber(regCount);
                  if (colInPlaceEl) colInPlaceEl.textContent = formatNumber(collectedInPlace);
                  if (colFromHomeEl) colFromHomeEl.textContent = formatNumber(collectedFromHome);
                  if (colEl) colEl.textContent = formatNumber(collected);
                  if (pctEl) {
                    const pct = regCount > 0 ? (Number(collected) / Number(regCount)) * 100 : 0;
                    pctEl.textContent = `${pct.toFixed(2)}%`;
                  }
                }
              });
            }

            // update region-level DOM
            const regionRegEl = document.getElementById(`region-registered-${region.id}`);
            const regionInPlaceEl = document.getElementById(`region-in-place-${region.id}`);
            const regionFromHomeEl = document.getElementById(`region-from-home-${region.id}`);
            const regionColEl = document.getElementById(`region-total-${region.id}`);
            const regionPctEl = document.getElementById(`region-percent-${region.id}`);
            if (regionRegEl) regionRegEl.innerHTML = formatRegisteredWithRik(regionRegisteredSum, region.RIK_totalRegionRegisteredVoters);
            if (regionInPlaceEl) regionInPlaceEl.textContent = formatNumber(regionCollectedInPlaceSum);
            if (regionFromHomeEl) regionFromHomeEl.textContent = formatNumber(regionCollectedFromHomeSum);
            if (regionColEl) regionColEl.textContent = formatNumber(regionCollectedSum);
            if (regionPctEl) {
              const pct = regionRegisteredSum > 0 ? (Number(regionCollectedSum) / Number(regionRegisteredSum)) * 100 : 0;
              regionPctEl.textContent = `${pct.toFixed(2)}%`;
            }
          });
        }

        // Refresh Controller Activity badges when config changed
        if (configChangedWhileRunning) {
          const locale = getLocaleDictionary();
          const refreshBadge = (place) => {
            const row = document.querySelector(`tr[data-id="place-${place.id}"]`);
            if (!row) return;
            const cells = row.querySelectorAll('td');
            const lastCell = cells[cells.length - 1];
            if (!lastCell) return;
            const s = String(place.senderStatus ?? '0');
            const key = `controllerStatus${s}`;
            const label = locale[key] || locale.controllerStatus0 || 'Not Covered';
            lastCell.innerHTML = `<span class="ctrl-status ctrl-status-${s}">${label}</span>`;
          };
          regionsForSummary.forEach(region => {
            if (Array.isArray(region.municipalities)) {
              region.municipalities.forEach(mun => (mun.places || []).forEach(refreshBadge));
            }
            (region.places || []).forEach(place => {
              if (Array.isArray(place.subPlaces) && place.subPlaces.length) {
                place.subPlaces.forEach(refreshBadge);
              } else {
                refreshBadge(place);
              }
            });
          });
        }
      }

      async function refreshDebugRawMessagesTable() {
        const tbody = document.getElementById('debugRawMessagesBody');
        if (!tbody) return;
        const locale = getLocaleDictionary();
        const emptyText = locale.debugRawMessagesEmpty || 'No raw Signal bridge messages.';
        const incomingLabel = locale.debugDirectionIncoming || 'incoming';
        const outgoingLabel = locale.debugDirectionOutgoing || 'outgoing';

        try {
          const response = await fetch('/api/signal/raw-messages');
          const payload = await response.json();
          const rows = Array.isArray(payload) ? payload : [];
          const sorted = rows
            .slice()
            .sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));

          if (!sorted.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="signal-empty-state">${escapeHtml(emptyText)}</td></tr>`;
            return;
          }

          // Smart DOM update: only prepend new rows, never touch existing ones so
          // horizontal scroll position on each <pre> is preserved during interval refreshes.
          const existingIds = new Set(
            Array.from(tbody.querySelectorAll('tr[data-raw-id]')).map((tr) => tr.dataset.rawId)
          );

          // Build new rows in order (newest first), insert only those not yet present
          const fragment = document.createDocumentFragment();
          let hasNew = false;
          for (const row of sorted) {
            if (existingIds.has(row.id)) continue;
            hasNew = true;
            const dt = row.receivedAt ? new Date(row.receivedAt) : null;
            const date = dt ? dt.toLocaleDateString() : '--';
            const time = dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--';
            const direction = row.direction === 'outgoing' ? outgoingLabel : incomingLabel;
            const rawPayload = row.rawPayload || '';
            const tr = document.createElement('tr');
            tr.dataset.rawId = row.id;
            tr.innerHTML = `<td>${escapeHtml(date)}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(direction)}</td><td><pre class="debug-raw-payload">${escapeHtml(rawPayload)}</pre></td>`;
            fragment.appendChild(tr);
          }

          if (hasNew) {
            // Remove placeholder empty-state row if present
            const emptyRow = tbody.querySelector('td[colspan]');
            if (emptyRow) emptyRow.closest('tr').remove();
            // Prepend new rows before existing ones (newest first order)
            tbody.insertBefore(fragment, tbody.firstChild);
          }
        } catch (error) {
          if (!tbody.querySelector('tr[data-raw-id]')) {
            tbody.innerHTML = `<tr><td colspan="4" class="signal-empty-state">${escapeHtml(emptyText)}</td></tr>`;
          }
        }
      }

      async function refreshIrregularitiesTable() {
        const tbody = document.getElementById('irregularitiesBody');
        if (!tbody) return;
        const locale = getLocaleDictionary();
        try {
          const response = await fetch('/api/irregularities');
          const rows = await response.json();
          irregularitiesRecords = Array.isArray(rows) ? rows : [];
          if (irregularitiesTreeBuiltForConfig !== cachedConfig) buildIrregularitiesTree(cachedConfig);
          else updateIrregularitiesTreeCounts();
          const filteredRows = irregularitiesRecords.filter(irregularityMatchesFilter);
          renderIrregularityRows(filteredRows);
        } catch (error) {
          tbody.innerHTML = `<tr><td colspan="4" class="irregularity-empty">${escapeHtml(locale.irregularitiesEmpty || 'No irregularities reported.')}</td></tr>`;
        }
      }

      function irregularityMatchesFilter(row) {
        if (!row || irregularitiesFilter.type === 'all') return true;
        return String(row[irregularitiesFilter.type] || '') === String(irregularitiesFilter.value);
      }

      function irregularityCount(filter) {
        return irregularitiesRecords.filter((row) => {
          if (!filter || filter.type === 'all') return true;
          return String(row && row[filter.type] || '') === String(filter.value);
        }).length;
      }

      function makeIrregularitiesTreeNode(label, filter, children, initiallyExpanded = false) {
        const item = document.createElement('li');
        item.className = 'irregularities-tree-item';
        const row = document.createElement('div');
        row.className = 'irregularities-tree-node-row';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'irregularities-tree-toggle';
        toggle.textContent = children && children.length ? (initiallyExpanded ? '▼' : '▶') : '';
        const labelButton = document.createElement('button');
        labelButton.type = 'button';
        labelButton.className = 'irregularities-tree-row';
        labelButton.dataset.filterType = filter.type;
        labelButton.dataset.filterValue = filter.value;
        labelButton.style.padding = '0';
        labelButton.style.flex = '1';
        const labelText = document.createElement('span');
        labelText.className = 'irregularities-tree-label';
        labelText.textContent = label;
        const count = document.createElement('span');
        count.className = 'irregularities-tree-count';
        count.textContent = String(irregularityCount(filter));
        labelButton.append(labelText, count);
        row.append(toggle, labelButton);
        item.appendChild(row);

        if (children && children.length) {
          const childList = document.createElement('ul');
          childList.className = 'irregularities-tree-children';
          childList.hidden = !initiallyExpanded;
          children.forEach((child) => childList.appendChild(child));
          item.appendChild(childList);
          toggle.addEventListener('click', () => {
            const expanded = childList.hidden;
            childList.hidden = !expanded;
            toggle.textContent = expanded ? '▼' : '▶';
          });
        }
        const select = () => {
          irregularitiesFilter = filter;
          refreshIrregularitiesTreeSelection();
          renderFilteredIrregularitiesTable();
        };
        labelButton.addEventListener('click', select);
        return item;
      }

      function refreshIrregularitiesTreeSelection() {
        document.querySelectorAll('#irregularitiesTree .irregularities-tree-row[data-filter-type]').forEach((row) => {
          const active = row.dataset.filterType === irregularitiesFilter.type && row.dataset.filterValue === String(irregularitiesFilter.value);
          row.classList.toggle('active', active);
        });
      }

      function updateIrregularitiesTreeCounts() {
        document.querySelectorAll('#irregularitiesTree .irregularities-tree-row[data-filter-type]').forEach((row) => {
          const count = row.querySelector('.irregularities-tree-count');
          if (count) count.textContent = String(irregularityCount({ type: row.dataset.filterType, value: row.dataset.filterValue }));
        });
      }

      function renderFilteredIrregularitiesTable() {
        renderIrregularityRows(irregularitiesRecords.filter(irregularityMatchesFilter));
      }

      function renderIrregularityRows(rows) {
        const tbody = document.getElementById('irregularitiesBody');
        if (!tbody) return;
        const locale = getLocaleDictionary();
        if (!rows.some((row) => String(row.id) === String(selectedIrregularityId))) selectedIrregularityId = null;
        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="irregularity-empty">${escapeHtml(locale.irregularitiesEmpty || 'No irregularities reported.')}</td></tr>`;
          updateIrregularityPreviewButton();
          return;
        }
        tbody.innerHTML = rows.map((row) => {
          const date = row.receivedAt ? new Date(row.receivedAt) : null;
          const checked = String(row.id) === String(selectedIrregularityId) ? ' checked' : '';
          return `<tr data-irregularity-id="${escapeHtml(row.id)}"><td class="irregularity-select-cell"><input class="irregularity-select" type="checkbox" aria-label="Select irregularity" data-irregularity-id="${escapeHtml(row.id)}"${checked}></td><td>${escapeHtml(date ? date.toLocaleDateString() : '--')}</td><td>${escapeHtml(date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--')}</td><td>${escapeHtml(row.place || '--')}</td><td>${escapeHtml(row.explanation || '')}</td></tr>`;
        }).join('');
        updateIrregularityPreviewButton();
      }

      function updateIrregularityPreviewButton() {
        const button = document.getElementById('irregularityPreviewBtn');
        if (button) button.disabled = !selectedIrregularityId;
      }

      function setupPreviewPhotoFrame(documentEl, reflowElement) {
        const photoFrame = documentEl?.querySelector('.photo-frame');
        const photo = photoFrame?.querySelector('.photo');
        if (!documentEl || !photoFrame || !photo) return;
        let photoRatio = 1;
        let photoWidth = 0;
        const getPhotoLimits = () => {
          const documentStyle = getComputedStyle(documentEl);
          const documentRect = documentEl.getBoundingClientRect();
          const frameRect = photoFrame.getBoundingClientRect();
          const contentWidth = documentEl.clientWidth - parseFloat(documentStyle.paddingLeft) - parseFloat(documentStyle.paddingRight);
          const frameOffsetFromTop = frameRect.top - documentRect.top;
          const availableHeight = Math.max(80, documentEl.clientHeight - frameOffsetFromTop - parseFloat(documentStyle.paddingBottom) - 12);
          return { maxWidth: Math.max(80, contentWidth), maxHeight: Math.max(80, availableHeight) };
        };
        const fitPhotoToPage = () => {
          const limits = getPhotoLimits();
          const naturalWidth = photo.naturalWidth || photo.offsetWidth;
          const naturalHeight = photo.naturalHeight || photo.offsetHeight;
          if (!naturalWidth || !naturalHeight) return;
          photoRatio = naturalWidth / naturalHeight;
          const maxWidthFromHeight = limits.maxHeight * photoRatio;
          const maximumWidth = Math.min(limits.maxWidth, maxWidthFromHeight);
          photoWidth = Math.min(photoWidth || maximumWidth, maximumWidth);
          photoFrame.style.width = `${photoWidth}px`;
          photo.style.maxHeight = `${limits.maxHeight}px`;
          photo.style.maxWidth = `${limits.maxWidth}px`;
        };
        const resizePhoto = (event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = photoFrame.getBoundingClientRect().width;
          const limits = getPhotoLimits();
          const onMove = (moveEvent) => {
            const width = Math.min(limits.maxWidth, limits.maxHeight * photoRatio, Math.max(80, startWidth + moveEvent.clientX - startX));
            photoWidth = width;
            photoFrame.style.width = `${width}px`;
          };
          const onEnd = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onEnd, { once: true });
        };
        photo.addEventListener('load', fitPhotoToPage);
        if (photo.complete) fitPhotoToPage();
        photoFrame.querySelector('.photo-resize-handle')?.addEventListener('pointerdown', resizePhoto);
        reflowElement?.addEventListener('input', fitPhotoToPage);
        window.addEventListener('resize', fitPhotoToPage, { once: true });
      }

      function setupIrregularitySelection() {
        const tbody = document.getElementById('irregularitiesBody');
        const preview = document.getElementById('irregularityPreviewBtn');
        if (!tbody || tbody.dataset.ready) return;
        tbody.dataset.ready = '1';
        tbody.addEventListener('change', (event) => {
          const checkbox = event.target.closest('.irregularity-select');
          if (!checkbox) return;
          selectedIrregularityId = checkbox.checked ? checkbox.dataset.irregularityId : null;
          renderFilteredIrregularitiesTable();
        });
        preview?.addEventListener('click', () => {
          if (document.querySelector('.menu-item.active')?.dataset.panel === 'zap-records') openZapPreview();
          else openIrregularityPreview();
        });
        updateIrregularityPreviewButton();
      }

      function openIrregularityPreview() {
        const record = irregularitiesRecords.find((row) => String(row.id) === String(selectedIrregularityId));
        if (!record) return;
        const locale = getLocaleDictionary();
        const date = record.receivedAt ? new Date(record.receivedAt) : null;
        const dateText = date ? `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}` : '--';
        const attachment = (record.attachments || []).find((item) => item && item.storedFilename);
        const imageUrl = attachment ? `/api/irregularities/${encodeURIComponent(record.id)}/attachments/${(record.attachments || []).indexOf(attachment)}` : '';
        const defaultName = `${String(record.place || 'voting-place').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${date ? date.toISOString().replace(/[:.]/g, '-') : 'report'}.pdf`;
        const modal = document.getElementById('irregularityPreviewModal');
        const documentEl = document.getElementById('irregularityPreviewDocument');
        if (modal && documentEl) {
          documentEl.classList.remove('zap-preview-document');
          documentEl.dataset.defaultFilename = defaultName;
          documentEl.dataset.previewType = 'irregularity';
          documentEl.dataset.recordId = String(record.id);
          documentEl.dataset.urgency = String(normalizeIrregularityCategory('urgency', record.urgency));
          documentEl.dataset.violation = String(normalizeIrregularityCategory('violation', record.violation));
          documentEl.dataset.severity = String(normalizeIrregularityCategory('severity', record.severity));
          document.querySelectorAll('.irregularity-preview-category-select').forEach((select) => { select.hidden = false; });
          const institutionText = locale.irregularitiesInstitution || 'Републичка изборна комисија\nКраља Милана 14\n11000 Београд, Србија';
          documentEl.innerHTML = `<div class="category-summary">${renderIrregularityCategorySummary(record, locale)}</div><div class="report-institution">${escapeHtml(institutionText)}</div><div class="subject"><strong>${escapeHtml(locale.irregularitiesSubject || 'Subject:')}</strong> ${escapeHtml(locale.irregularitiesSubjectText || 'Report of an irregularity at a polling station.')}</div><section class="location"><div><strong>${escapeHtml(locale.irregularitiesRegion || 'Region')}:</strong> ${escapeHtml(record.region || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesMunicipality || 'Municipality')}:</strong> ${escapeHtml(record.municipality || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesPlace || 'Voting place')}:</strong> ${escapeHtml(record.place || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesDateTime || 'Date and time')}:</strong> ${escapeHtml(dateText)}</div></section><div class="description-label">${escapeHtml(locale.irregularitiesDescriptionHeading || 'Irregularity description:')}</div><div class="description" contenteditable="true" role="textbox" aria-multiline="true">${escapeHtml(record.explanation || '')}</div>${imageUrl ? `<div class="photo-frame"><img class="photo" src="${imageUrl}" alt="${escapeHtml(locale.irregularitiesPhoto || 'Photo')}"><button class="photo-resize-handle" type="button" aria-label="Resize photo" title="Resize photo"></button></div>` : ''}`;
          setIrregularityCategoryControls(record);
          const description = documentEl.querySelector('.description');
          setupPreviewPhotoFrame(documentEl, description);
          modal.hidden = false;
          document.body.classList.add('irregularity-modal-open');
          documentEl.scrollTop = 0;
          modal.querySelector('.irregularity-preview-window')?.focus();
          document.getElementById('irregularityPreviewFileMenu').hidden = true;
          return;
        }
        const popup = window.open('', 'irregularity-preview', 'popup,width=900,height=1000');
        if (!popup) return;
        popup.document.open();
        popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(defaultName)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:Arial,sans-serif}.toolbar{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid #cbd5e1;background:#f8fafc;position:sticky;top:0}.toolbar h1{font-size:16px;flex:1;margin:0}.file{position:relative}.file>button,.file-menu button{font:inherit;padding:7px 12px;border:1px solid #94a3b8;background:white;border-radius:4px;cursor:pointer}.file-menu{position:absolute;right:0;top:100%;display:grid;min-width:120px;background:white;border:1px solid #cbd5e1;box-shadow:0 4px 12px #0002}.file-menu[hidden]{display:none}.file-menu button{border:0;border-radius:0;text-align:left}.close{border:0;background:transparent;font-size:20px;cursor:pointer}.report{max-width:174mm;margin:22mm auto 0}.report h2{text-align:center;font-size:20px;margin:0 0 18mm}.location{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;border-bottom:1px solid #cbd5e1;padding-bottom:10mm}.location strong{display:block;font-size:11px;text-transform:uppercase;color:#64748b;margin-bottom:3px}.statement{font-size:16px;font-weight:700;margin:14mm 0 8mm}.description{font-size:14px;line-height:1.55;white-space:pre-wrap}.photo{display:block;max-width:100%;max-height:105mm;margin:14mm auto 0;object-fit:contain}@media print{.toolbar{display:none}.report{margin:0 auto}}</style></head><body><header class="toolbar"><h1>${escapeHtml(locale.irregularitiesPreviewTitle || 'Voting irregularity incident report')}</h1><div class="file"><button id="fileButton">${escapeHtml(locale.irregularitiesFile || 'File')}</button><div id="fileMenu" class="file-menu" hidden><button id="saveButton">${escapeHtml(locale.irregularitiesSave || 'Save')}</button><button id="saveAsButton">${escapeHtml(locale.irregularitiesSaveAs || 'Save as')}</button></div></div><button class="close" id="closeButton" aria-label="Close">X</button></header><main class="report"><h2>${escapeHtml(locale.irregularitiesPreviewTitle || 'Voting irregularity incident report')}</h2><section class="location"><div><strong>${escapeHtml(locale.irregularitiesRegion || 'Region')}</strong>${escapeHtml(record.region || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesMunicipality || 'Municipality')}</strong>${escapeHtml(record.municipality || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesPlace || 'Voting place')}</strong>${escapeHtml(record.place || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesDateTime || 'Date and time')}</strong>${escapeHtml(dateText)}</div></section><div class="statement">${escapeHtml(locale.irregularitiesIncidentStatement || 'This is a voting irregularity incident report.')}</div><div class="description">${escapeHtml(record.explanation || '')}</div>${imageUrl ? `<img class="photo" src="${imageUrl}" alt="${escapeHtml(locale.irregularitiesPhoto || 'Photo')}">` : ''}</main><script>const fileButton=document.getElementById('fileButton'),fileMenu=document.getElementById('fileMenu');fileButton.onclick=()=>fileMenu.hidden=!fileMenu.hidden;document.getElementById('closeButton').onclick=()=>window.close();document.getElementById('saveButton').onclick=()=>window.print();document.getElementById('saveAsButton').onclick=()=>window.print();document.addEventListener('click',e=>{if(!e.target.closest('.file'))fileMenu.hidden=true});<\/script></body></html>`);
        popup.document.close();
        popup.focus();
      }

      function setupIrregularityPreviewModal() {
        const modal = document.getElementById('irregularityPreviewModal');
        const close = () => {
          if (!modal) return;
          modal.hidden = true;
          document.body.classList.remove('irregularity-modal-open');
          document.getElementById('irregularityPreviewBtn')?.focus();
        };
        document.getElementById('irregularityPreviewCloseBtn')?.addEventListener('click', close);
        modal?.querySelector('[data-preview-close]')?.addEventListener('click', close);
        document.getElementById('irregularityPreviewFileBtn')?.addEventListener('click', () => {
          const menu = document.getElementById('irregularityPreviewFileMenu');
          if (menu) menu.hidden = !menu.hidden;
        });
        const printReport = () => {
          const menu = document.getElementById('irregularityPreviewFileMenu');
          if (menu) menu.hidden = true;
          const documentEl = document.getElementById('irregularityPreviewDocument');
          const previousTitle = document.title;
          if (documentEl && documentEl.dataset.defaultFilename) document.title = documentEl.dataset.defaultFilename;
          document.body.classList.add('printing-irregularity');
          window.print();
          window.setTimeout(() => {
            document.body.classList.remove('printing-irregularity');
            document.title = previousTitle;
          }, 500);
        };
        const saveReport = async () => {
          const menu = document.getElementById('irregularityPreviewFileMenu');
          if (menu) menu.hidden = true;
          const documentEl = document.getElementById('irregularityPreviewDocument');
          if (!documentEl) return;
          const recordId = documentEl.dataset.recordId;
          const previewType = documentEl.dataset.previewType;
          const saveButton = document.getElementById('irregularityPreviewSaveBtn');
          const locale = getLocaleDictionary();
          const originalText = saveButton?.textContent || locale.irregularitiesSave || 'Save';
          if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = locale.irregularitiesSaving || 'Saving...';
          }
          try {
            if (previewType === 'zap') {
              const record = zapRecords.find((row) => String(row.id) === String(recordId || selectedZapRecordId));
              if (!record || !recordId) throw new Error('zap-record-not-found');
              const response = await fetch(`/api/zap-records/${encodeURIComponent(recordId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  region: record.region,
                  municipality: record.municipality,
                  place: record.place,
                  receivedAt: record.receivedAt
                })
              });
              if (!response.ok) throw new Error(`Save failed: ${response.status}`);
              const payload = await response.json();
              const index = zapRecords.findIndex((row) => String(row.id) === String(recordId));
              if (index >= 0) zapRecords[index] = payload.record;
              renderZapRecords();
              if (saveButton) saveButton.textContent = locale.irregularitiesSaved || 'Saved';
              return;
            }

            const description = documentEl.querySelector('.description');
            if (!description || !recordId || previewType !== 'irregularity') return;
            const response = await fetch(`/api/irregularities/${encodeURIComponent(recordId)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                explanation: description.innerText.replace(/\u00a0/g, ' ').trim(),
                urgency: normalizeIrregularityCategory('urgency', documentEl.dataset.urgency),
                violation: normalizeIrregularityCategory('violation', documentEl.dataset.violation),
                severity: normalizeIrregularityCategory('severity', documentEl.dataset.severity)
              })
            });
            if (!response.ok) throw new Error(`Save failed: ${response.status}`);
            const payload = await response.json();
            const index = irregularitiesRecords.findIndex((row) => String(row.id) === String(recordId));
            if (index >= 0) irregularitiesRecords[index] = payload.record;
            renderFilteredIrregularitiesTable();
            if (saveButton) saveButton.textContent = locale.irregularitiesSaved || 'Saved';
          } catch (error) {
            if (saveButton) saveButton.textContent = locale.irregularitiesSaveFailed || 'Save failed';
          } finally {
            window.setTimeout(() => {
              if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = originalText;
              }
            }, 900);
          }
        };
        document.getElementById('irregularityPreviewSaveBtn')?.addEventListener('click', saveReport);
        document.getElementById('irregularityPreviewSaveAsBtn')?.addEventListener('click', printReport);
        ['urgency', 'violation', 'severity'].forEach((category) => {
          const select = document.getElementById(`irregularityPreview${category[0].toUpperCase()}${category.slice(1)}Select`);
          select?.addEventListener('change', () => {
            const documentEl = document.getElementById('irregularityPreviewDocument');
            if (!documentEl) return;
            documentEl.dataset[category] = String(normalizeIrregularityCategory(category, select.value));
            updateIrregularityCategorySummary();
          });
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && modal && !modal.hidden) close();
        });
      }

      function buildIrregularitiesTree(config) {
        const tree = document.getElementById('irregularitiesTree');
        if (!tree || !config) return;
        tree.innerHTML = '';
        const root = document.createElement('ul');
        root.className = 'irregularities-tree-list';
        const locale = getLocaleDictionary();
        const regionNodes = getRegions(config).map((region) => {
          const municipalityNodes = (region.municipalities || []).map((municipality) => {
            const placeNodes = (municipality.places || []).map((place) => makeIrregularitiesTreeNode(
              place.name || `Place ${place.id}`,
              { type: 'place', value: place.name || place.id },
              []
            ));
            return makeIrregularitiesTreeNode(
              municipality.name || `Municipality ${municipality.id}`,
              { type: 'municipality', value: municipality.name || municipality.id },
              placeNodes
            );
          });
          return makeIrregularitiesTreeNode(
            region.name || `Region ${region.id}`,
            { type: 'region', value: region.name || region.id },
            municipalityNodes
          );
        });
        root.appendChild(makeIrregularitiesTreeNode(
          locale.irregularitiesAll || 'All voting places',
          { type: 'all', value: 'all' },
          regionNodes,
          true
        ));
        tree.appendChild(root);
        refreshIrregularitiesTreeSelection();
        irregularitiesTreeBuiltForConfig = config;
      }

      function setupIrregularitiesSplitter() {
        const workspace = document.querySelector('.irregularities-workspace');
        const splitter = document.getElementById('irregularitiesSplitter');
        if (!workspace || !splitter || splitter.dataset.ready) return;
        splitter.dataset.ready = '1';
        const setWidth = (clientX) => {
          const rect = workspace.getBoundingClientRect();
          const width = Math.max(180, Math.min(rect.width - 300, clientX - rect.left));
          workspace.style.gridTemplateColumns = `${width}px 8px minmax(0, 1fr)`;
        };
        splitter.addEventListener('pointerdown', (event) => {
          splitter.setPointerCapture(event.pointerId);
          const move = (moveEvent) => setWidth(moveEvent.clientX);
          const stop = () => {
            splitter.removeEventListener('pointermove', move);
            splitter.removeEventListener('pointerup', stop);
            splitter.removeEventListener('pointercancel', stop);
          };
          splitter.addEventListener('pointermove', move);
          splitter.addEventListener('pointerup', stop);
          splitter.addEventListener('pointercancel', stop);
        });
        splitter.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const rect = workspace.getBoundingClientRect();
          const current = parseFloat(getComputedStyle(workspace).gridTemplateColumns.split(' ')[0]);
          setWidth(rect.left + current + (event.key === 'ArrowRight' ? 20 : -20));
        });
      }

      function setupZapSplitter() {
        const workspace = document.querySelector('#panel-zap-records .irregularities-workspace');
        const splitter = document.getElementById('zapSplitter');
        if (!workspace || !splitter || splitter.dataset.ready) return;
        splitter.dataset.ready = '1';
        const setWidth = (clientX) => {
          const rect = workspace.getBoundingClientRect();
          const width = Math.max(180, Math.min(rect.width - 300, clientX - rect.left));
          workspace.style.gridTemplateColumns = `${width}px 8px minmax(0, 1fr)`;
        };
        splitter.addEventListener('pointerdown', (event) => {
          splitter.setPointerCapture(event.pointerId);
          const move = (moveEvent) => setWidth(moveEvent.clientX);
          const stop = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', stop); splitter.removeEventListener('pointercancel', stop); };
          splitter.addEventListener('pointermove', move); splitter.addEventListener('pointerup', stop); splitter.addEventListener('pointercancel', stop);
        });
      }

      function zapMatchesFilter(row) {
        if (!row || zapFilter.type === 'all') return true;
        return String(row[zapFilter.type] || '') === String(zapFilter.value);
      }

      function zapCount(filter) {
        return zapRecords.filter((row) => !filter || filter.type === 'all' || String(row && row[filter.type] || '') === String(filter.value)).length;
      }

      function buildZapTree(config) {
        const tree = document.getElementById('zapTree');
        if (!tree || !config) return;
        tree.innerHTML = '';
        const root = document.createElement('ul'); root.className = 'irregularities-tree-list';
        const makeNode = (label, filter, children, expanded = false) => {
          const item = document.createElement('li'); item.className = 'irregularities-tree-item';
          const row = document.createElement('div'); row.className = 'irregularities-tree-node-row';
          const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'irregularities-tree-toggle'; toggle.textContent = children.length ? (expanded ? '▼' : '▶') : '';
          const select = document.createElement('button'); select.type = 'button'; select.className = 'irregularities-tree-row'; select.style.padding = '0'; select.style.flex = '1'; select.dataset.filterType = filter.type; select.dataset.filterValue = filter.value;
          const name = document.createElement('span'); name.className = 'irregularities-tree-label'; name.textContent = label;
          const count = document.createElement('span'); count.className = 'irregularities-tree-count'; count.textContent = String(zapCount(filter)); select.append(name, count); row.append(toggle, select); item.append(row);
          if (children.length) { const list = document.createElement('ul'); list.className = 'irregularities-tree-children'; list.hidden = !expanded; children.forEach((child) => list.appendChild(child)); item.append(list); toggle.addEventListener('click', () => { list.hidden = !list.hidden; toggle.textContent = list.hidden ? '▶' : '▼'; }); }
          select.addEventListener('click', () => { zapFilter = filter; document.querySelectorAll('#zapTree .irregularities-tree-row').forEach((el) => el.classList.toggle('active', el === select)); renderZapRecords(); });
          return item;
        };
        const regions = getRegions(config).map((region) => makeNode(region.name || `Region ${region.id}`, { type: 'region', value: region.name || region.id }, (region.municipalities || []).map((mun) => makeNode(mun.name || `Municipality ${mun.id}`, { type: 'municipality', value: mun.name || mun.id }, (mun.places || []).map((place) => makeNode(place.name || `Place ${place.id}`, { type: 'place', value: place.name || place.id }, []))))));
        const locale = getLocaleDictionary(); root.appendChild(makeNode(locale.irregularitiesAll || 'All voting places', { type: 'all', value: 'all' }, regions, true)); tree.appendChild(root); zapTreeBuiltForConfig = config;
      }

      function renderZapRecords() {
        const tbody = document.getElementById('zapRecordsBody'); if (!tbody) return;
        const rows = zapRecords.filter(zapMatchesFilter);
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="4" class="irregularity-empty">${escapeHtml(getLocaleDictionary().zapRecordsEmpty || 'No voting records reported.')}</td></tr>`; updateZapPreviewButton(); return; }
        if (!rows.some((row) => String(row.id) === String(selectedZapRecordId))) selectedZapRecordId = null;
        tbody.innerHTML = rows.map((row) => { const date = row.receivedAt ? new Date(row.receivedAt) : null; const checked = String(row.id) === String(selectedZapRecordId) ? ' checked' : ''; return `<tr data-zap-id="${escapeHtml(row.id)}"><td class="irregularity-select-cell"><input class="zap-select" type="checkbox" aria-label="Select voting record" data-zap-id="${escapeHtml(row.id)}"${checked}></td><td>${escapeHtml(date ? date.toLocaleDateString() : '--')}</td><td>${escapeHtml(date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--')}</td><td>${escapeHtml(row.place || '--')}</td></tr>`; }).join('');
        updateZapPreviewButton();
      }

      function updateZapPreviewButton() {
        const button = document.getElementById('irregularityPreviewBtn');
        if (button && document.querySelector('.menu-item.active')?.dataset.panel === 'zap-records') button.disabled = !selectedZapRecordId;
      }

      function setupZapSelection() {
        const tbody = document.getElementById('zapRecordsBody');
        if (!tbody || tbody.dataset.selectionReady) return;
        tbody.dataset.selectionReady = '1';
        tbody.addEventListener('change', (event) => {
          const checkbox = event.target.closest('.zap-select');
          if (!checkbox) return;
          selectedZapRecordId = checkbox.checked ? checkbox.dataset.zapId : null;
          renderZapRecords();
        });
      }

      function openZapPreview() {
        const record = zapRecords.find((row) => String(row.id) === String(selectedZapRecordId));
        if (!record) return;
        const attachment = (record.attachments || []).find((item) => item && item.storedFilename);
        const imageUrl = attachment ? `/api/zap-records/${encodeURIComponent(record.id)}/attachments/${(record.attachments || []).indexOf(attachment)}` : '';
        const date = record.receivedAt ? new Date(record.receivedAt) : null;
        const documentEl = document.getElementById('irregularityPreviewDocument');
        const modal = document.getElementById('irregularityPreviewModal');
        if (!documentEl || !modal) return;
        documentEl.classList.add('zap-preview-document');
        documentEl.dataset.defaultFilename = `${String(record.place || 'voting-record').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${date ? date.toISOString().replace(/[:.]/g, '-') : 'record'}.pdf`;
        documentEl.dataset.previewType = 'zap';
        documentEl.dataset.recordId = String(record.id);
        ['urgency', 'violation', 'severity'].forEach((category) => { delete documentEl.dataset[category]; });
        setIrregularityCategoryControls({ urgency: 0, violation: 0, severity: 0 });
        document.querySelectorAll('.irregularity-preview-category-select').forEach((select) => { select.hidden = true; });
        const locale = getLocaleDictionary();
        const formattedDateTime = date ? `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}` : '--';
        documentEl.innerHTML = `<div class="zap-header"><div class="zap-title-block"><h2>${escapeHtml(locale.zapPreviewTitle || 'Polling station voting record')}</h2><div class="zap-place"><strong>${escapeHtml(locale.irregularitiesPlace || 'Voting place')}:</strong> ${escapeHtml(record.place || '--')}</div></div><div class="zap-meta"><div><strong>${escapeHtml(locale.irregularitiesRegion || 'Region')}:</strong> ${escapeHtml(record.region || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesMunicipality || 'Municipality')}:</strong> ${escapeHtml(record.municipality || '--')}</div><div><strong>${escapeHtml(locale.irregularitiesDateTime || 'Date and time')}:</strong> ${escapeHtml(formattedDateTime)}</div></div></div>${imageUrl ? `<div class="photo-frame"><img class="photo" src="${imageUrl}" alt="${escapeHtml(locale.zapPhoto || 'Photo')}"><button class="photo-resize-handle" type="button" aria-label="Resize photo" title="Resize photo"></button></div>` : ''}`;
        setupPreviewPhotoFrame(documentEl);
        modal.hidden = false;
        document.body.classList.add('irregularity-modal-open');
        documentEl.scrollTop = 0;
        modal.querySelector('.irregularity-preview-window')?.focus();
      }

      async function refreshZapRecords() {
        try { const response = await fetch('/api/zap-records'); zapRecords = await response.json(); if (zapTreeBuiltForConfig !== cachedConfig) buildZapTree(cachedConfig); else updateZapTreeCounts(); renderZapRecords(); } catch (error) { zapRecords = []; updateZapTreeCounts(); renderZapRecords(); }
      }

      function updateZapTreeCounts() {
        document.querySelectorAll('#zapTree .irregularities-tree-row[data-filter-type]').forEach((row) => {
          const count = row.querySelector('.irregularities-tree-count');
          if (count) count.textContent = String(zapCount({ type: row.dataset.filterType, value: row.dataset.filterValue }));
        });
      }

      function setupDatabaseTab() {
        const btn = document.getElementById('dbClearDataBtn');
        if (!btn) return;

        const allCb = document.getElementById('dbClearAll');
        const itemCbs = Array.from(document.querySelectorAll('.db-clear-item'));

        // ALL → sync all items
        allCb?.addEventListener('change', () => {
          itemCbs.forEach((cb) => { cb.checked = allCb.checked; });
        });

        // Any item → update ALL indeterminate/checked state
        itemCbs.forEach((cb) => {
          cb.addEventListener('change', () => {
            const checkedCount = itemCbs.filter((c) => c.checked).length;
            if (allCb) {
              allCb.indeterminate = checkedCount > 0 && checkedCount < itemCbs.length;
              allCb.checked = checkedCount === itemCbs.length;
            }
          });
        });

        btn.addEventListener('click', async () => {
          const locale = getLocaleDictionary();
          const operations = [];
          const clearRawMessages = Boolean(document.getElementById('dbClearRawMessages')?.checked);
          const clearIrregularities = Boolean(document.getElementById('dbClearIrregularities')?.checked);
          const clearZapRecords = Boolean(document.getElementById('dbClearZapRecords')?.checked);
          if (document.getElementById('dbClearSender')?.checked) operations.push('sender');
          if (document.getElementById('dbClearStatus')?.checked) operations.push('status');
          if (document.getElementById('dbClearTurnout')?.checked) operations.push('turnout');
          if (document.getElementById('dbClearResults')?.checked) operations.push('results');
          if (document.getElementById('dbClearCorrection')?.checked) operations.push('correction');

          const resultEl = document.getElementById('dbClearDataResult');
          if (!operations.length && !clearRawMessages && !clearIrregularities && !clearZapRecords) {
            if (resultEl) resultEl.textContent = locale.dbClearNoneSelected || 'Select at least one option.';
            return;
          }

          if (clearRawMessages && !window.confirm(locale.dbClearRawMessagesConfirm || 'Delete all raw messages? This cannot be undone.')) return;
          if (clearIrregularities && !window.confirm(locale.dbClearIrregularitiesConfirm || 'Delete all irregularities? This cannot be undone.')) return;
          if (clearZapRecords && !window.confirm(locale.dbClearZapRecordsConfirm || 'Delete all polling station records? This cannot be undone.')) return;

          try {
            if (operations.length) {
              const response = await fetch('/api/config/clear-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operations })
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Data clear failed');
            }

            if (clearIrregularities) {
              const response = await fetch('/api/irregularities', { method: 'DELETE' });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Irregularities delete failed');
              await refreshIrregularitiesTable();
            }

            if (clearZapRecords) {
              const response = await fetch('/api/zap-records', { method: 'DELETE' });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Polling station records delete failed');
              await refreshZapRecords();
            }

            if (clearRawMessages) {
              const response = await fetch('/api/signal/raw-messages', { method: 'DELETE' });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Raw message delete failed');
              if (resultEl) resultEl.textContent = (locale.dbClearRawMessagesSuccess || 'Raw messages deleted: {count}.').replace('{count}', formatNumber(data.removed || 0));
              await refreshDebugRawMessagesTable();
            } else if (resultEl) {
              resultEl.textContent = locale.dbClearSuccess || 'Data cleared successfully.';
            }
            document.querySelectorAll('.db-clear-item').forEach((checkbox) => { checkbox.checked = false; });
            if (allCb) {
              allCb.checked = false;
              allCb.indeterminate = false;
            }
          } catch (err) {
            if (resultEl) resultEl.textContent = err.message || locale.dbClearFailed || 'Failed to clear data.';
          }
        });
      }

      function getDebugMessageVisibleColumnCount() {
        return Object.values(debugMessageColumnVisibility).filter(Boolean).length + 1;
      }

      function applyDebugMessageColumnVisibility() {
        const cells = document.querySelectorAll('.debug-valid-message-table [data-debug-message-col]');
        cells.forEach((cell) => {
          const key = cell.dataset.debugMessageCol;
          if (key === 'select') {
            cell.style.display = '';
            return;
          }
          const visible = Object.prototype.hasOwnProperty.call(debugMessageColumnVisibility, key)
            ? debugMessageColumnVisibility[key]
            : true;
          cell.style.display = visible ? '' : 'none';
        });

        const emptyCells = document.querySelectorAll('.debug-valid-empty-state');
        const span = Math.max(1, getDebugMessageVisibleColumnCount());
        emptyCells.forEach((cell) => {
          cell.colSpan = span;
        });
      }

      function getDebugMessageFilterSelections() {
        return {
          dateFrom: document.getElementById('debugMessageFilterDateFrom')?.value || '',
          dateTo: document.getElementById('debugMessageFilterDateTo')?.value || '',
          timeFrom: document.getElementById('debugMessageFilterTimeFrom')?.value || '',
          timeTo: document.getElementById('debugMessageFilterTimeTo')?.value || '',
          party: document.getElementById('debugMessageFilterParty')?.value || '',
          message: document.getElementById('debugMessageFilterMessage')?.value || ''
        };
      }

      function isDebugMessageFilterEngaged() {
        const filters = getDebugMessageFilterSelections();
        if (debugMessageColumnVisibility.date && (filters.dateFrom || filters.dateTo)) return true;
        if (debugMessageColumnVisibility.time && (filters.timeFrom || filters.timeTo)) return true;
        if (debugMessageColumnVisibility.party && filters.party) return true;
        if (debugMessageColumnVisibility.message && filters.message) return true;
        return false;
      }

      function updateDebugMessageFilterEngagedState() {
        const filterEl = document.getElementById('debugMessageFilterPanel');
        if (!filterEl) return;
        filterEl.classList.toggle('engaged', isDebugMessageFilterEngaged());
      }

      function applyDebugMessageFilterControlState() {
        const mapping = {
          date: { controlsId: 'debugMessageFilterDateControls', selectIds: ['debugMessageFilterDateFrom', 'debugMessageFilterDateTo'] },
          time: { controlsId: 'debugMessageFilterTimeControls', selectIds: ['debugMessageFilterTimeFrom', 'debugMessageFilterTimeTo'] },
          party: { controlsId: 'debugMessageFilterPartyControls', selectIds: ['debugMessageFilterParty'] },
          message: { controlsId: 'debugMessageFilterMessageControls', selectIds: ['debugMessageFilterMessage'] }
        };

        Object.entries(mapping).forEach(([key, cfg]) => {
          const controls = document.getElementById(cfg.controlsId);
          const visible = Boolean(debugMessageColumnVisibility[key]);
          if (controls) controls.classList.toggle('hidden', !visible);
          cfg.selectIds.forEach((id) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.disabled = !visible;
            if (!visible) select.value = '';
          });
        });
        updateDebugMessageFilterEngagedState();
      }

      function setupDebugMessageColumnToggles() {
        const toggles = document.querySelectorAll('[data-debug-message-col-toggle]');
        toggles.forEach((toggle) => {
          toggle.addEventListener('change', () => {
            const key = toggle.dataset.debugMessageColToggle;
            if (!key || !Object.prototype.hasOwnProperty.call(debugMessageColumnVisibility, key)) return;
            debugMessageColumnVisibility[key] = Boolean(toggle.checked);
            if (Object.values(debugMessageColumnVisibility).filter(Boolean).length === 0) {
              debugMessageColumnVisibility[key] = true;
              toggle.checked = true;
              return;
            }
            applyDebugMessageFilterControlState();
            renderDebugValidMessageTables(debugValidMessagesCache);
          });
        });
      }

      function setupDebugMessageFilterControls() {
        ['debugMessageFilterDateFrom', 'debugMessageFilterDateTo', 'debugMessageFilterTimeFrom', 'debugMessageFilterTimeTo', 'debugMessageFilterParty', 'debugMessageFilterMessage']
          .forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
              updateDebugMessageFilterEngagedState();
              renderDebugValidMessageTables(debugValidMessagesCache);
            });
          });
        applyDebugMessageFilterControlState();
      }

      function applyDebugMessageFilters(rows, isOutgoing) {
        const filters = getDebugMessageFilterSelections();
        return (rows || []).filter((row) => {
          const meta = getSignalRowMeta(row, isOutgoing);
          if (debugMessageColumnVisibility.date) {
            if (filters.dateFrom && (!meta.dateKey || meta.dateKey < filters.dateFrom)) return false;
            if (filters.dateTo && (!meta.dateKey || meta.dateKey > filters.dateTo)) return false;
          }
          if (debugMessageColumnVisibility.time) {
            if (filters.timeFrom && (!meta.timeKey || meta.timeKey < filters.timeFrom)) return false;
            if (filters.timeTo && (!meta.timeKey || meta.timeKey > filters.timeTo)) return false;
          }
          if (debugMessageColumnVisibility.party && filters.party && meta.labelCell !== filters.party) return false;
          if (debugMessageColumnVisibility.message && filters.message && meta.typeLabel !== filters.message) return false;
          return true;
        });
      }

      function rebuildDebugMessageFilterOptions(messages) {
        const locale = getLocaleDictionary();
        const allLabel = locale.signalFilterAll || 'ALL';
        const datesMap = new Map();
        const timesMap = new Map();
        const partiesSet = new Set();
        const messageTypesSet = new Set();

        (messages || []).forEach((row) => {
          const isOutgoing = (row.direction || 'incoming') === 'outgoing';
          const meta = getSignalRowMeta(row, isOutgoing);
          if (meta.dateKey) datesMap.set(meta.dateKey, meta.dateText);
          if (meta.timeKey) timesMap.set(meta.timeKey, meta.timeKey);
          if (meta.labelCell) partiesSet.add(meta.labelCell);
          if (meta.typeLabel) messageTypesSet.add(meta.typeLabel);
        });

        const dateEntries = Array.from(datesMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([value, text]) => ({ value, text }));
        const timeEntries = Array.from(timesMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([value, text]) => ({ value, text }));
        const partyEntries = Array.from(partiesSet).sort((a, b) => String(a).localeCompare(String(b))).map((value) => ({ value, text: value }));
        const messageEntries = Array.from(messageTypesSet).sort((a, b) => String(a).localeCompare(String(b))).map((value) => ({ value, text: value }));

        populateSignalFilterSelect(document.getElementById('debugMessageFilterDateFrom'), dateEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('debugMessageFilterDateTo'), dateEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('debugMessageFilterTimeFrom'), timeEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('debugMessageFilterTimeTo'), timeEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('debugMessageFilterParty'), partyEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('debugMessageFilterMessage'), messageEntries, allLabel);
        updateDebugMessageFilterEngagedState();
      }

      function updateDebugSelectAllState(rowIds, selectAllId) {
        const selectAll = document.getElementById(selectAllId);
        if (!selectAll) return;
        if (!rowIds.length) {
          selectAll.checked = false;
          selectAll.indeterminate = false;
          return;
        }
        const selectedCount = rowIds.filter((id) => debugSelectedMessageIds.has(id)).length;
        selectAll.checked = selectedCount === rowIds.length;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < rowIds.length;
      }

      function renderDebugValidRows(rows, tbodyId, emptyText, isOutgoing, selectAllId) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="${Math.max(1, getDebugMessageVisibleColumnCount())}" class="signal-empty-state debug-valid-empty-state">${escapeHtml(emptyText)}</td></tr>`;
          applyDebugMessageColumnVisibility();
          updateDebugSelectAllState([], selectAllId);
          return;
        }

        tbody.innerHTML = rows.map((row) => {
          const meta = getSignalRowMeta(row, isOutgoing);
          const id = String(row.id || '');
          const checked = id && debugSelectedMessageIds.has(id) ? ' checked' : '';
          return `<tr><td data-debug-message-col="select"><input class="debug-valid-select" data-message-id="${escapeHtml(id)}" type="checkbox"${checked}></td><td data-debug-message-col="date">${escapeHtml(meta.dateText)}</td><td data-debug-message-col="time">${escapeHtml(meta.timeText)}</td><td data-debug-message-col="party">${escapeHtml(meta.labelCell)}</td><td data-debug-message-col="message">${escapeHtml(meta.text)}</td></tr>`;
        }).join('');
        applyDebugMessageColumnVisibility();

        const rowIds = rows.map((row) => String(row.id || '')).filter(Boolean);
        updateDebugSelectAllState(rowIds, selectAllId);
        tbody.querySelectorAll('input.debug-valid-select[data-message-id]').forEach((checkbox) => {
          checkbox.addEventListener('change', () => {
            const id = checkbox.dataset.messageId;
            if (!id) return;
            if (checkbox.checked) {
              debugSelectedMessageIds.add(id);
            } else {
              debugSelectedMessageIds.delete(id);
            }
            updateDebugSelectAllState(rowIds, selectAllId);
          });
        });
      }

      function renderDebugValidMessageTables(allMessages) {
        const locale = getLocaleDictionary();
        const incomingEmpty = locale.signalEmptyIncoming || 'No incoming messages for this group yet.';
        const outgoingEmpty = locale.signalEmptyOutgoing || 'No outgoing messages for this group yet.';
        const selectedGroupId = document.getElementById('signalGroupSelect')?.value || '';

        const groupScopedRows = (allMessages || []).filter((message) => {
          if (!selectedGroupId) return true;
          if (!message.groupId) return true;
          return message.groupId === selectedGroupId;
        });

        rebuildDebugMessageFilterOptions(groupScopedRows);
        const incomingRows = applyDebugMessageFilters(groupScopedRows
          .filter((message) => (message.direction || 'incoming') === 'incoming')
          .sort((a, b) => new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0)), false);

        const outgoingRows = applyDebugMessageFilters(groupScopedRows
          .filter((message) => (message.direction || 'incoming') === 'outgoing')
          .sort((a, b) => new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0)), true);

        renderDebugValidRows(incomingRows, 'debugValidIncomingBody', incomingEmpty, false, 'debugSelectAllIncoming');
        renderDebugValidRows(outgoingRows, 'debugValidOutgoingBody', outgoingEmpty, true, 'debugSelectAllOutgoing');
      }

      async function refreshDebugValidMessageTables() {
        try {
          const response = await fetch('/api/messages');
          const payload = await response.json();
          debugValidMessagesCache = Array.isArray(payload) ? payload : [];
          renderDebugValidMessageTables(debugValidMessagesCache);
        } catch (error) {
          debugValidMessagesCache = [];
          renderDebugValidMessageTables([]);
        }
      }

      async function deleteSelectedDebugMessages() {
        const resultEl = document.getElementById('debugSelectedMessageActionResult');
        const locale = getLocaleDictionary();
        const ids = Array.from(debugSelectedMessageIds);
        if (!ids.length) {
          if (resultEl) {
            resultEl.textContent = locale.debugDeleteSelectedNone || 'Select at least one message.';
          }
          return;
        }

        try {
          const response = await fetch('/api/messages/delete-selected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) {
            throw new Error('delete-selected-failed');
          }
          debugSelectedMessageIds = new Set();
          if (resultEl) {
            const template = locale.debugDeleteSelectedResult || 'Deleted selected messages: {count}.';
            resultEl.textContent = template.replace('{count}', String(payload.removed || 0));
          }
          await refreshSignalMessageTables();
          await refreshDebugValidMessageTables();
          await loadSummary();
        } catch (error) {
          if (resultEl) {
            resultEl.textContent = locale.debugDeleteFailed || 'Failed to delete messages.';
          }
        }
      }

      function setupDebugMessageActions() {
        const deleteSelectedBtn = document.getElementById('debugDeleteSelectedMessagesBtn');
        if (deleteSelectedBtn) {
          deleteSelectedBtn.onclick = async () => {
            await deleteSelectedDebugMessages();
          };
        }

        const connectSelectAll = (id, tbodyId) => {
          const selectAll = document.getElementById(id);
          if (!selectAll) return;
          selectAll.onchange = () => {
            const tbody = document.getElementById(tbodyId);
            if (!tbody) return;
            tbody.querySelectorAll('input.debug-valid-select[data-message-id]').forEach((checkbox) => {
              checkbox.checked = selectAll.checked;
              const messageId = checkbox.dataset.messageId;
              if (!messageId) return;
              if (selectAll.checked) debugSelectedMessageIds.add(messageId);
              else debugSelectedMessageIds.delete(messageId);
            });
            const rowIds = Array.from(tbody.querySelectorAll('input.debug-valid-select[data-message-id]'))
              .map((checkbox) => checkbox.dataset.messageId)
              .filter(Boolean);
            updateDebugSelectAllState(rowIds, id);
          };
        };
        connectSelectAll('debugSelectAllIncoming', 'debugValidIncomingBody');
        connectSelectAll('debugSelectAllOutgoing', 'debugValidOutgoingBody');
      }

      let lastSignalStatus = null;
      let lastSignalHeartbeatMs = 60000;
      let signalMessagesCache = [];
      let debugValidMessagesCache = [];
      let debugSelectedMessageIds = new Set();
      const signalColumnVisibility = {
        date: true,
        time: true,
        party: true,
        message: true
      };
      const debugMessageColumnVisibility = {
        date: true,
        time: true,
        party: true,
        message: true
      };

      function formatSignalCountdown(lastCheckIso, heartbeatMs) {
        const timeoutMs = Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : 60000;
        if (!lastCheckIso) return '--';
        const lastCheck = new Date(lastCheckIso).getTime();
        if (!Number.isFinite(lastCheck)) return '--';
        const elapsed = Date.now() - lastCheck;
        const cycleElapsed = ((elapsed % timeoutMs) + timeoutMs) % timeoutMs;
        const remainingMs = timeoutMs - cycleElapsed;
        const remainingSeconds = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
        return `${remainingSeconds}s`;
      }

      function setupSignalMessageTabs() {
        const buttons = document.querySelectorAll('.signal-message-tab-btn');
        const panels = document.querySelectorAll('.signal-message-tab-panel');

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const targetId = button.dataset.signalMessageTab;
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel) return;

            buttons.forEach((btn) => {
              const isActive = btn === button;
              btn.classList.toggle('active', isActive);
              btn.setAttribute('aria-selected', String(isActive));
            });

            panels.forEach((panel) => {
              const isActive = panel.id === targetId;
              panel.classList.toggle('active', isActive);
              panel.style.display = isActive ? 'block' : 'none';
            });
          });
        });
      }

      function getSignalVisibleColumnCount() {
        return Object.values(signalColumnVisibility).filter(Boolean).length;
      }

      function applySignalColumnVisibility() {
        const cells = document.querySelectorAll('.signal-message-table [data-signal-col]');
        cells.forEach((cell) => {
          const key = cell.dataset.signalCol;
          const visible = Object.prototype.hasOwnProperty.call(signalColumnVisibility, key)
            ? signalColumnVisibility[key]
            : true;
          cell.style.display = visible ? '' : 'none';
        });

        const emptyCells = document.querySelectorAll('.signal-empty-state');
        const span = Math.max(1, getSignalVisibleColumnCount());
        emptyCells.forEach((cell) => {
          cell.colSpan = span;
        });
      }

      function applySignalFilterControlState() {
        const mapping = {
          date: { controlsId: 'signalFilterDateControls', selectIds: ['signalFilterDateFrom', 'signalFilterDateTo'] },
          time: { controlsId: 'signalFilterTimeControls', selectIds: ['signalFilterTimeFrom', 'signalFilterTimeTo'] },
          party: { controlsId: 'signalFilterPartyControls', selectIds: ['signalFilterParty'] },
          message: { controlsId: 'signalFilterMessageControls', selectIds: ['signalFilterMessage'] }
        };

        Object.entries(mapping).forEach(([key, cfg]) => {
          const controls = document.getElementById(cfg.controlsId);
          const visible = Boolean(signalColumnVisibility[key]);
          if (controls) {
            controls.classList.toggle('hidden', !visible);
          }
          cfg.selectIds.forEach((id) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.disabled = !visible;
            if (!visible) select.value = '';
          });
        });
        updateSignalFilterEngagedState();
      }

      function setupSignalColumnToggles() {
        const toggles = document.querySelectorAll('[data-signal-col-toggle]');
        toggles.forEach((toggle) => {
          toggle.addEventListener('change', () => {
            const key = toggle.dataset.signalColToggle;
            if (!key || !Object.prototype.hasOwnProperty.call(signalColumnVisibility, key)) return;
            signalColumnVisibility[key] = Boolean(toggle.checked);
            if (getSignalVisibleColumnCount() === 0) {
              signalColumnVisibility[key] = true;
              toggle.checked = true;
              return;
            }
            applySignalFilterControlState();
            refreshSignalMessageTables();
          });
        });
      }

      function getSignalLocalDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }

      function getSignalLocalTimeKey(date) {
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      }

      function getSignalLabelCell(row, isOutgoing) {
        const sender = row.sender || row.groupName || 'Signal';
        return isOutgoing ? (row.groupName || row.target || 'Signal') : sender;
      }

      function getSignalMessageTypeLabel(row) {
        const type = String(row && row.type ? row.type : '').toLowerCase();
        if (type === 'register-controller') return 'Reg';
        if (type === 'vote') return 'Voted';
        if (type === 'attendance') return 'Present';
        return '';
      }

      function getSignalRowMeta(row, isOutgoing) {
        const dateObj = row.receivedAt ? new Date(row.receivedAt) : null;
        const text = row.rawMessage || row.text || row.message || '';
        const labelCell = getSignalLabelCell(row, isOutgoing);
        const typeLabel = getSignalMessageTypeLabel(row);
        return {
          dateObj,
          dateKey: dateObj ? getSignalLocalDateKey(dateObj) : '',
          timeKey: dateObj ? getSignalLocalTimeKey(dateObj) : '',
          dateText: dateObj ? dateObj.toLocaleDateString() : '--',
          timeText: dateObj ? dateObj.toLocaleTimeString() : '--',
          labelCell,
          text,
          typeLabel
        };
      }

      function getSignalFilterSelections() {
        return {
          dateFrom: document.getElementById('signalFilterDateFrom')?.value || '',
          dateTo: document.getElementById('signalFilterDateTo')?.value || '',
          timeFrom: document.getElementById('signalFilterTimeFrom')?.value || '',
          timeTo: document.getElementById('signalFilterTimeTo')?.value || '',
          party: document.getElementById('signalFilterParty')?.value || '',
          message: document.getElementById('signalFilterMessage')?.value || ''
        };
      }

      function isSignalFilterEngaged() {
        const filters = getSignalFilterSelections();
        if (signalColumnVisibility.date && (filters.dateFrom || filters.dateTo)) return true;
        if (signalColumnVisibility.time && (filters.timeFrom || filters.timeTo)) return true;
        if (signalColumnVisibility.party && filters.party) return true;
        if (signalColumnVisibility.message && filters.message) return true;
        return false;
      }

      function updateSignalFilterEngagedState() {
        const filterEl = document.getElementById('signalColumnFilterPanel');
        if (!filterEl) return;
        filterEl.classList.toggle('engaged', isSignalFilterEngaged());
      }

      function populateSignalFilterSelect(selectEl, entries, allLabel) {
        if (!selectEl) return;
        const previousValue = selectEl.value || '';
        selectEl.innerHTML = '';

        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = allLabel;
        selectEl.appendChild(allOption);

        entries.forEach((entry) => {
          const option = document.createElement('option');
          option.value = entry.value;
          option.textContent = entry.text;
          selectEl.appendChild(option);
        });

        if (previousValue && entries.some((entry) => entry.value === previousValue)) {
          selectEl.value = previousValue;
        } else {
          selectEl.value = '';
        }
      }

      function rebuildSignalFilterOptions(messages) {
        const locale = getLocaleDictionary();
        const allLabel = locale.signalFilterAll || 'ALL';

        const datesMap = new Map();
        const timesMap = new Map();
        const partiesSet = new Set();
        const messageTypesSet = new Set();

        (messages || []).forEach((row) => {
          const isOutgoing = (row.direction || 'incoming') === 'outgoing';
          const meta = getSignalRowMeta(row, isOutgoing);
          if (meta.dateKey) datesMap.set(meta.dateKey, meta.dateText);
          if (meta.timeKey) timesMap.set(meta.timeKey, meta.timeKey);
          if (meta.labelCell) partiesSet.add(meta.labelCell);
          if (meta.typeLabel) messageTypesSet.add(meta.typeLabel);
        });

        const dateEntries = Array.from(datesMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, text]) => ({ value, text }));
        const timeEntries = Array.from(timesMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, text]) => ({ value, text }));
        const partyEntries = Array.from(partiesSet)
          .sort((a, b) => String(a).localeCompare(String(b)))
          .map((value) => ({ value, text: value }));
        const messageEntries = Array.from(messageTypesSet)
          .sort((a, b) => String(a).localeCompare(String(b)))
          .map((value) => ({ value, text: value }));

        populateSignalFilterSelect(document.getElementById('signalFilterDateFrom'), dateEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('signalFilterDateTo'), dateEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('signalFilterTimeFrom'), timeEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('signalFilterTimeTo'), timeEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('signalFilterParty'), partyEntries, allLabel);
        populateSignalFilterSelect(document.getElementById('signalFilterMessage'), messageEntries, allLabel);
        updateSignalFilterEngagedState();
      }

      function applySignalFilters(rows, isOutgoing) {
        const filters = getSignalFilterSelections();
        return (rows || []).filter((row) => {
          const meta = getSignalRowMeta(row, isOutgoing);
          if (signalColumnVisibility.date) {
            if (filters.dateFrom && (!meta.dateKey || meta.dateKey < filters.dateFrom)) return false;
            if (filters.dateTo && (!meta.dateKey || meta.dateKey > filters.dateTo)) return false;
          }
          if (signalColumnVisibility.time) {
            if (filters.timeFrom && (!meta.timeKey || meta.timeKey < filters.timeFrom)) return false;
            if (filters.timeTo && (!meta.timeKey || meta.timeKey > filters.timeTo)) return false;
          }
          if (signalColumnVisibility.party && filters.party && meta.labelCell !== filters.party) return false;
          if (signalColumnVisibility.message && filters.message && meta.typeLabel !== filters.message) return false;
          return true;
        });
      }

      function setupSignalFilterControls() {
        ['signalFilterDateFrom', 'signalFilterDateTo', 'signalFilterTimeFrom', 'signalFilterTimeTo', 'signalFilterParty', 'signalFilterMessage']
          .forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
              updateSignalFilterEngagedState();
              refreshSignalMessageTables();
            });
          });
        applySignalFilterControlState();
      }

      function renderSignalMessageRows(rows, tbodyId, emptyText, isOutgoing) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="4" class="signal-empty-state">${emptyText}</td></tr>`;
          applySignalColumnVisibility();
          return;
        }

        tbody.innerHTML = rows.map((row) => {
          const meta = getSignalRowMeta(row, isOutgoing);
          return `<tr><td data-signal-col="date">${escapeHtml(meta.dateText)}</td><td data-signal-col="time">${escapeHtml(meta.timeText)}</td><td data-signal-col="party">${escapeHtml(meta.labelCell)}</td><td data-signal-col="message">${escapeHtml(meta.text)}</td></tr>`;
        }).join('');
        applySignalColumnVisibility();
      }

      async function refreshSignalMessageTables() {
        const locale = getLocaleDictionary();
        const incomingEmpty = locale.signalEmptyIncoming || 'No incoming messages for this group yet.';
        const outgoingEmpty = locale.signalEmptyOutgoing || 'No outgoing messages for this group yet.';

        try {
          const response = await fetch('/api/messages');
          const payload = await response.json();
          signalMessagesCache = Array.isArray(payload) ? payload : [];
          debugValidMessagesCache = signalMessagesCache.slice();

          const groupSelect = document.getElementById('signalGroupSelect');
          const selectedGroupId = groupSelect ? groupSelect.value : '';
          const groupScopedRows = signalMessagesCache
            .filter((message) => {
              if (!selectedGroupId) return true;
              if (!message.groupId) return true;
              return message.groupId === selectedGroupId;
            });

          rebuildSignalFilterOptions(groupScopedRows);

          const incomingRows = applySignalFilters(groupScopedRows
            .filter((message) => (message.direction || 'incoming') === 'incoming')
            .sort((a, b) => new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0)), false);

          const outgoingRows = applySignalFilters(groupScopedRows
            .filter((message) => (message.direction || 'incoming') === 'outgoing')
            .sort((a, b) => new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0)), true);

          renderSignalMessageRows(incomingRows, 'signalIncomingMessagesBody', incomingEmpty, false);
          renderSignalMessageRows(outgoingRows, 'signalOutgoingMessagesBody', outgoingEmpty, true);
          renderDebugValidMessageTables(debugValidMessagesCache);
        } catch (err) {
          renderSignalMessageRows([], 'signalIncomingMessagesBody', incomingEmpty, false);
          renderSignalMessageRows([], 'signalOutgoingMessagesBody', outgoingEmpty, true);
          debugValidMessagesCache = [];
          renderDebugValidMessageTables([]);
        }
      }

      function updateSignalCountdownDisplay() {
        const summaryEl = document.getElementById('signalSummary');
        if (!summaryEl || !lastSignalStatus) return;

        const locale = getLocaleDictionary();
        const bridgeLabel = locale.signalBridgeLabel || 'Bridge';
        const countdownLabel = locale.signalCountdownLabel || 'Next check';
        const messageLabel = locale.signalMessageLabel || 'Message';

        if (!lastSignalStatus.connected) {
          summaryEl.innerHTML = `
            <strong>${bridgeLabel}:</strong> disconnected<br>
            <strong>${countdownLabel}:</strong> --
          `;
          return;
        }

        summaryEl.innerHTML = `
          <strong>${bridgeLabel}:</strong> connected<br>
          <strong>${countdownLabel}:</strong> ${formatSignalCountdown(lastSignalStatus.lastCheck, lastSignalHeartbeatMs)}
        `;
      }

      async function refreshSignalPanel() {
        const statusEl = document.getElementById('signalStatusBadge');
        const summaryEl = document.getElementById('signalSummary');
        const selectEl = document.getElementById('signalGroupSelect');
        if (!statusEl || !summaryEl || !selectEl) return;

        try {
          const configRes = await fetch('/api/signal/config');
          const config = await configRes.json();
          const heartbeatMs = Number(config.heartbeatTimeoutMs || 60000);
          lastSignalHeartbeatMs = Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : 60000;
          const statusRes = await fetch('/api/signal/status');
          const status = await statusRes.json();
          lastSignalStatus = status || null;
          const groupsRes = await fetch('/api/signal/groups');
          const groupsPayload = await groupsRes.json();
          const groups = Array.isArray(groupsPayload.groups) ? groupsPayload.groups : [];

          statusEl.textContent = status.connected ? 'Signal OK' : 'Signal offline';
          statusEl.classList.toggle('connected', Boolean(status.connected));
          statusEl.classList.toggle('disconnected', !status.connected);

          selectEl.innerHTML = '';
          const locale = getLocaleDictionary();
          const placeholder = locale.signalGroupPlaceholder || '-- Select group --';
          const bridgeLabel = locale.signalBridgeLabel || 'Bridge';
          const countdownLabel = locale.signalCountdownLabel || 'Next check';
          const messageLabel = locale.signalMessageLabel || 'Message';
          if (!status.connected) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '';
            option.selected = true;
            selectEl.appendChild(option);
            const offlineMessage = locale.signalOfflineMessage || 'Please start Signal App on this computer.';
            statusEl.textContent = `${status.connected ? 'Signal OK' : 'Signal offline'} — ${offlineMessage}`;
            summaryEl.innerHTML = `
              <strong>${bridgeLabel}:</strong> disconnected<br>
              <strong>${countdownLabel}:</strong> --
            `;
            await refreshSignalMessageTables();
            return;
          }
          if (!groups.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = placeholder;
            option.selected = true;
            selectEl.appendChild(option);
            summaryEl.innerHTML = `
              <strong>${bridgeLabel}:</strong> connected<br>
              <strong>${countdownLabel}:</strong> ${formatSignalCountdown(status.lastCheck, heartbeatMs)}
            `;
            await refreshSignalMessageTables();
            return;
          }

          const blankOption = document.createElement('option');
          blankOption.value = '';
          blankOption.textContent = placeholder;
          blankOption.selected = !status.selectedGroupId;
          selectEl.appendChild(blankOption);

          const selected = status.selectedGroupId || '';
          groups.forEach((group) => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            option.selected = group.id === selected;
            selectEl.appendChild(option);
          });

          summaryEl.innerHTML = `
            <strong>${bridgeLabel}:</strong> connected<br>
            <strong>${countdownLabel}:</strong> ${formatSignalCountdown(status.lastCheck, heartbeatMs)}
          `;
          await refreshSignalMessageTables();
        } catch (err) {
          const locale = getLocaleDictionary();
          const offlineMessage = locale.signalOfflineMessage || 'Please start Signal App on this computer.';
          statusEl.textContent = `Signal offline — ${offlineMessage}`;
          statusEl.classList.remove('connected');
          statusEl.classList.add('disconnected');
          summaryEl.innerHTML = `
            <strong>${locale.signalBridgeLabel || 'Bridge'}:</strong> disconnected<br>
            <strong>${locale.signalCountdownLabel || 'Next check'}:</strong> --<br>
          `;
        }
      }

      document.addEventListener('DOMContentLoaded', async () => {
        // menu behavior
        document.querySelectorAll('.menu-item').forEach(btn => {
          btn.addEventListener('click', (e) => {
            document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const panel = e.target.dataset.panel;
            document.getElementById('pageTitle').textContent = e.target.textContent;
            setIrregularitiesActionsVisibility(panel);
            document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active-panel'));
            const sel = document.getElementById('panel-' + panel);
            if (sel) { sel.style.display = ''; sel.classList.add('active-panel'); }
          });
        });

        setupDebugTabs();
        setupDebugMessageActions();
        setupDebugMessageColumnToggles();
        setupDebugMessageFilterControls();
        setupDatabaseTab();
        setupSignalMessageTabs();
        setupSignalColumnToggles();
        setupSignalFilterControls();
        setupIrregularitySelection();
        setupZapSelection();
        setupIrregularityPreviewModal();
        setupZapSplitter();
        await refreshSignalPanel();
        await refreshSignalMessageTables();
        await refreshDebugValidMessageTables();
        await refreshDebugRawMessagesTable();
        await refreshIrregularitiesTable();
        await refreshZapRecords();
        setupIrregularitiesSplitter();
        document.getElementById('signalGroupSelect')?.addEventListener('change', async (event) => {
          const groupId = event.target.value;
          if (!groupId) {
            await refreshSignalMessageTables();
            return;
          }
          await fetch('/api/signal/select-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId })
          });
          await refreshSignalPanel();
          await refreshSignalMessageTables();
        });
        await loadConfigAndBuild();
        await refreshIrregularitiesTable();
        await refreshZapRecords();
        applyConfigHeader(cachedConfig);
        syncStopwatchDisplay();
        await refreshSignalMessageTables();
        await loadSummary();
        await globalThis.loadResultsSummary();
        setInterval(loadSummary, 5000);
        setInterval(() => globalThis.loadResultsSummary(), 5000);
        setInterval(refreshDebugValidMessageTables, 5000);
        setInterval(refreshDebugRawMessagesTable, 5000);
        setInterval(refreshIrregularitiesTable, 5000);
        setInterval(refreshZapRecords, 5000);
        setInterval(refreshSignalPanel, 8000);
        setInterval(updateSignalCountdownDisplay, 1000);

        function startClock() {
          function attach() {
            const el = document.getElementById('bannerClock');
            const dateEl = document.getElementById('bannerDate');
            if (!el || !dateEl) { setTimeout(attach, 300); return; }
            function tick() {
              const now = new Date();
              el.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
              dateEl.textContent = now.toLocaleDateString('en-GB');
            }
            tick();
            setInterval(tick, 1000);
          }
          attach();
        }
        startClock();

        document.getElementById('stopwatchStartBtn')?.addEventListener('click', () => {
          startStopwatch();
        });

        document.getElementById('stopwatchStopBtn')?.addEventListener('click', () => {
          stopStopwatch();
        });

      });
    