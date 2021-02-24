// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CellKind, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { disposeAllDisposables } from '../../common/helpers';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { NativeEditorNotebookModel } from '../notebookStorage/notebookModel';
import { INotebookEditor, INotebookEditorProvider } from '../types';

function hasLatexContent(content: string | string[]) {
    if (Array.isArray(content)) {
        return content.some(hasLatexContent);
    }
    return content.includes('$') || content.includes('begin{');
}
@injectable()
export class CellLatexTracker implements IExtensionSingleActivationService {
    private sentTelemetryForHavingLatex?: boolean;
    private sentTelemetryForNotHavingLatex?: boolean;
    private readonly disposables: IDisposable[] = [];

    constructor(
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(UseVSCodeNotebookEditorApi) useVSCApi: boolean,
        @inject(IDisposableRegistry) disposables: IDisposable[]
    ) {
        disposables.push(this);
        if (useVSCApi) {
            this.vscNotebook.onDidChangeNotebookDocument(
                (e) => this.onCheckNotebookDocument(e.document),
                this.disposables
            );
            this.vscNotebook.onDidOpenNotebookDocument((e) => this.onCheckNotebookDocument(e), this.disposables);
        } else {
            this.notebookEditorProvider.onDidChangeActiveNotebookEditor(
                (t) => this.onOpenedOrClosedNotebook(t),
                this,
                this.disposables
            );
        }
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async activate(): Promise<void> {
        // Act like all of our open documents just opened; our timeout will make sure this is delayed.
        this.notebookEditorProvider.editors.forEach((e) => this.onOpenedOrClosedNotebook(e));
        this.vscNotebook.notebookDocuments.forEach((e) => this.onCheckNotebookDocument(e));
    }
    private readonly mapOfModels = new WeakSet<NativeEditorNotebookModel>();
    private trackModel(model: NativeEditorNotebookModel) {
        if (this.mapOfModels.has(model)) {
            return;
        }
        this.mapOfModels.add(model);
        model.onDidEdit(() => this.onModelChanged(model), this, this.disposables);
    }
    private onCheckNotebookDocument(doc: NotebookDocument) {
        const hasLatex = doc.cells.some(
            (item) => item.cellKind === CellKind.Markdown && hasLatexContent(item.document.getText())
        );
        this.sendTelemetry(hasLatex);
    }
    private onModelChanged(model: NativeEditorNotebookModel) {
        if (this.sentTelemetryForHavingLatex && this.sentTelemetryForNotHavingLatex) {
            this.dispose(); // No need to check any more documents.
            return;
        }
        const hasLatex = model.cells.some(
            (item) => item.data.cell_type === 'markdown' && hasLatexContent(item.data.source)
        );
        this.sendTelemetry(hasLatex);
    }
    private onOpenedOrClosedNotebook(e?: INotebookEditor) {
        if (e && e?.type !== 'native' && e.model instanceof NativeEditorNotebookModel) {
            this.trackModel(e.model);
        }
    }
    private sendTelemetry(hasLatex: boolean) {
        if (this.sentTelemetryForHavingLatex && this.sentTelemetryForNotHavingLatex) {
            this.dispose();
            return;
        }
        if (hasLatex) {
            this.sentTelemetryForHavingLatex = true;
        } else {
            this.sentTelemetryForNotHavingLatex = true;
        }
        sendTelemetryEvent(Telemetry.MarkdownCellHasLatex, undefined, { hasLatex: hasLatex ? 'true' : 'false' });
    }
}
