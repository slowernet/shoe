// ===== Data Model & LocalStorage =====

class KanbanApp {
    constructor() {
        this.schema = []
        this.records = []
        this.viewState = {
            groupBy: null
        }
        this.currentCardId = null
        this.currentPropertyId = null
        this.theme = 'light'
        
        this.init()
    }

    init() {
        this.loadFromStorage()
        this.setupTheme()
        this.pendingPropertyName = null
        this.setupEventListeners()
        this.render()
        this.initMicromodal()
    }

    initMicromodal() {
        if (typeof MicroModal !== 'undefined') {
            MicroModal.init({
                onShow: (modal) => {
                    if (modal.id === 'propertyNameModal') {
                        qs('#newPropertyNameInput').focus()
                        qs('#newPropertyNameInput').value = ''
                        qs('#newPropertyTypeSelect').value = 'text'
                    }
                }
            })
        }
    }

    // ===== Storage Management =====
    loadFromStorage() {
        const schema = localStorage.getItem('kanban_schema')
        const records = localStorage.getItem('kanban_records')
        const viewState = localStorage.getItem('kanban_view')
        const theme = localStorage.getItem('kanban_theme')

        this.schema = schema ? JSON.parse(schema) : [this.createTitleProperty()]
        this.records = records ? JSON.parse(records) : []
        this.viewState = viewState ? JSON.parse(viewState) : { groupBy: null }
        this.theme = theme ? theme : 'light'
    }

    saveToStorage() {
        localStorage.setItem('kanban_schema', JSON.stringify(this.schema))
        localStorage.setItem('kanban_records', JSON.stringify(this.records))
        localStorage.setItem('kanban_view', JSON.stringify(this.viewState))
        localStorage.setItem('kanban_theme', this.theme)
    }

    exportToJSON() {
        const data = {
            version: '1.0',
            schema: this.schema,
            records: this.records,
            viewState: this.viewState,
            exportedAt: new Date().toISOString()
        }
        return JSON.stringify(data, null, 2)
    }

    importFromJSON(jsonStr) {
        try {
            const data = JSON.parse(jsonStr)
            if (!data.schema || !data.records) {
                throw new Error('Invalid JSON format')
            }
            this.schema = data.schema
            this.records = data.records
            this.viewState = data.viewState || { groupBy: null }
            this.saveToStorage()
            this.render()
        } catch (error) {
            alert('Error importing JSON: ' + error.message)
        }
    }

    // ===== Property Management =====
    createTitleProperty() {
        return {
            id: this.generateId(),
            name: 'Title',
            type: 'text',
            visible: true,
            order: 0,
            isTitle: true
        }
    }

    addProperty(name, type = 'text', options = []) {
        const property = {
            id: this.generateId(),
            name,
            type,
            visible: true,
            order: this.schema.length,
            options: this.isSelectType(type) ? options : [],
            optionColors: {},
            columnOrder: []
        }
        this.schema.push(property)
        this.saveToStorage()
        return property
    }

    deleteProperty(propertyId) {
        const property = this.getProperty(propertyId)
        if (!property || property.isTitle) return
        
        this.schema = this.schema.filter(p => p.id !== propertyId)
        this.records.forEach(record => {
            delete record.values[propertyId]
        })
        this.saveToStorage()
    }

    updateProperty(propertyId, updates) {
        const property = this.getProperty(propertyId)
        if (!property) return

        // Handle type changes with data conversion
        if (updates.type && updates.type !== property.type) {
            this.convertPropertyType(propertyId, property.type, updates.type)
        }

        Object.assign(property, updates)
        this.saveToStorage()
    }

    convertPropertyType(propertyId, oldType, newType) {
        this.records.forEach(record => {
            const value = record.values[propertyId]
            if (value === null || value === undefined) return

            let converted = value
            
            if (newType === 'number') {
                converted = isNaN(value) ? null : Number(value)
            } else if (newType === 'text') {
                converted = String(value)
            } else if (newType === 'select') {
                // Keep if it's a string, otherwise clear
                converted = typeof value === 'string' ? value : null
            } else if (newType === 'multi-select') {
                // Convert single value to array
                if (Array.isArray(value)) {
                    converted = value
                } else if (typeof value === 'string') {
                    converted = [value]
                } else {
                    converted = []
                }
            } else if (newType === 'checkbox') {
                converted = Boolean(value)
            } else if (newType === 'date') {
                // Keep if valid date string, otherwise clear
                converted = /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null
            } else {
                converted = null
            }

            record.values[propertyId] = converted
        })
    }

    getProperty(propertyId) {
        return this.schema.find(p => p.id === propertyId)
    }

    getGroupableProperties() {
        return this.schema.filter(p => 
            ['select', 'multi-select', 'checkbox', 'number'].includes(p.type) && !p.isTitle
        )
    }

    // ===== Record Management =====
    createRecord(title = 'Untitled') {
        const record = {
            id: this.generateId(),
            title,
            description: '',
            values: {},
            position: 0
        }
        
        // Initialize values for all properties
        this.schema.forEach(property => {
            if (property.isTitle) return
            record.values[property.id] = null
        })

        this.records.push(record)
        this.saveToStorage()
        return record
    }

    updateRecord(recordId, updates) {
        const record = this.getRecord(recordId)
        if (!record) return
        Object.assign(record, updates)
        this.saveToStorage()
    }

    deleteRecord(recordId) {
        this.records = this.records.filter(r => r.id !== recordId)
        this.saveToStorage()
    }

    getRecord(recordId) {
        return this.records.find(r => r.id === recordId)
    }

    setRecordPropertyValue(recordId, propertyId, value) {
        const record = this.getRecord(recordId)
        if (record) {
            record.values[propertyId] = value
            this.saveToStorage()
        }
    }

    // ===== Board Logic =====
    getColumns() {
        if (!this.viewState.groupBy) return null

        const groupProperty = this.getProperty(this.viewState.groupBy)
        if (!groupProperty) return null

        const columns = {}
        let columnValues = new Set()

        // Collect all unique values
        this.records.forEach(record => {
            const value = record.values[this.viewState.groupBy]
            
            if (groupProperty.type === 'multi-select') {
                if (Array.isArray(value)) {
                    value.forEach(v => columnValues.add(v))
                }
            } else if (value !== null && value !== undefined) {
                columnValues.add(String(value))
            }
        })

        // For select fields, also include defined options
        if (groupProperty.type === 'select') {
            groupProperty.options.forEach(opt => columnValues.add(opt))
        }

        // Sort values - use custom order if available
        let sortedValues
        if (groupProperty.columnOrder && groupProperty.columnOrder.length > 0) {
            // Use custom order, adding any new values at the end
            const ordered = groupProperty.columnOrder.filter(val => columnValues.has(val))
            const unordered = Array.from(columnValues).filter(val => !groupProperty.columnOrder.includes(val))
            sortedValues = [...ordered, ...unordered.sort((a, b) => {
                if (groupProperty.type === 'number') {
                    return Number(a) - Number(b)
                }
                return String(a).localeCompare(String(b))
            })]
        } else {
            sortedValues = Array.from(columnValues).sort((a, b) => {
                if (groupProperty.type === 'number') {
                    return Number(a) - Number(b)
                }
                return String(a).localeCompare(String(b))
            })
        }

        // Create columns
        sortedValues.forEach(value => {
            columns[value] = {
                label: String(value),
                records: []
            }
        })

        // Always add "No value" column
        columns['__empty__'] = {
            label: 'No value',
            records: []
        }

        // Distribute records to columns
        this.records.forEach(record => {
            const value = record.values[this.viewState.groupBy]
            let columnKey = '__empty__'

            if (groupProperty.type === 'multi-select' && Array.isArray(value)) {
                if (value.length > 0) {
                    columnKey = value[0]
                }
            } else if (value !== null && value !== undefined) {
                columnKey = String(value)
            }

            if (columns[columnKey]) {
                columns[columnKey].records.push(record)
            }
        })

        // Sort records within each column by position
        Object.values(columns).forEach(column => {
            column.records.sort((a, b) => a.position - b.position)
        })

        return {
            property: groupProperty,
            columns: columns,
            columnOrder: sortedValues.concat(['__empty__'])
        }
    }

    // ===== Theme Management =====
    setupTheme() {
        const htmlElement = document.documentElement
        if (this.theme === 'dark') {
            htmlElement.setAttribute('data-theme', 'dark')
        } else {
            htmlElement.removeAttribute('data-theme')
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light'
        this.setupTheme()
        this.saveToStorage()
    }

    showSavedIndicator() {
        const indicator = qs('#savedIndicator')
        if (indicator) {
            indicator.classList.remove('hidden')
            setTimeout(() => {
                indicator.classList.add('hidden')
            }, 1500)
        }
    }

    // ===== Helper Methods =====
    saveCardAndRender() {
        this.showSavedIndicator()
        this.render()
        // Refresh modal if it's open
        if (this.currentCardId) {
            this.refreshCardModal()
        }
    }

    refreshCardModal() {
        if (!this.currentCardId) return
        const record = this.getRecord(this.currentCardId)
        if (!record) return

        const container = qs('#cardPropertiesContainer')
        container.innerHTML = ''

        this.schema.forEach(property => {
            if (property.isTitle) return
            const fieldEl = this.createPropertyFieldElement(record, property)
            container.appendChild(fieldEl)
        })
    }

    saveAndRender() {
        this.saveToStorage()
        this.renderBoard()
    }

    setupModalClose(modalId) {
        const modal = qs(modalId)
        if (!modal) return
        const closeBtn = modal.querySelector('.close-btn, [data-micromodal-close]')
        const overlay = modal.querySelector('.modal-overlay')
        
        const closeHandler = () => {
            modal.classList.add('hidden')
            if (typeof MicroModal !== 'undefined') {
                MicroModal.close(modalId.substring(1))
            }
        }
        
        if (closeBtn) closeBtn.onclick = closeHandler
        if (overlay) overlay.onclick = closeHandler
    }

    createSimpleInput(record, property, type, valueTransform) {
        const input = document.createElement('input')
        input.type = type
        input.className = type === 'checkbox' ? 'property-field-checkbox' : 'property-field-input'
        
        const value = record.values[property.id]
        if (type === 'checkbox') {
            input.checked = Boolean(value)
        } else {
            input.value = value !== null && value !== '' ? value : ''
        }
        
        input.onchange = () => {
            this.setRecordPropertyValue(record.id, property.id, valueTransform(input))
            this.saveCardAndRender()
        }
        
        return input
    }

    createSelectButtons(record, property, isMulti = false) {
        const container = document.createElement('div')
        container.className = 'property-field-select'
        
        property.options.forEach(option => {
            const btn = document.createElement('button')
            btn.className = 'select-option'
            btn.textContent = option
            
            // Check current state and apply checked class
            const currentValue = record.values[property.id]
            const isSelected = isMulti 
                ? (Array.isArray(currentValue) && currentValue.includes(option))
                : currentValue === option
            
            if (isSelected) {
                btn.classList.add('checked')
            }
            
            // Apply color if selected, otherwise light gray
            const color = property.optionColors?.[option]
            if (isSelected && color) {
                btn.style.backgroundColor = color
                btn.style.color = this.getContrastColor(color)
            } else if (!isSelected) {
                btn.style.backgroundColor = 'var(--color-bg-secondary)'
                btn.style.color = 'var(--color-text-secondary)'
            }
            
            btn.onclick = (e) => {
                e.preventDefault()
                const currentValue = record.values[property.id]
                const values = isMulti ? (Array.isArray(currentValue) ? currentValue : []) : null
                const isSelected = isMulti ? (values && values.includes(option)) : currentValue === option
                
                let newValue
                if (isMulti) {
                    newValue = isSelected
                        ? values.filter(v => v !== option)
                        : [...(values || []), option]
                    newValue = newValue.length > 0 ? newValue : null
                } else {
                    newValue = isSelected ? null : option
                }
                
                this.setRecordPropertyValue(record.id, property.id, newValue)
                this.saveCardAndRender()
            }
            container.appendChild(btn)
        })
        
        return container
    }

    getContrastColor(hexColor) {
        // Convert hex to RGB
        const r = parseInt(hexColor.slice(1, 3), 16)
        const g = parseInt(hexColor.slice(3, 5), 16)
        const b = parseInt(hexColor.slice(5, 7), 16)
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        return luminance > 0.5 ? '#000000' : '#ffffff'
    }

    formatDate(dateStr) {
        if (!dateStr) return ''
        const date = new Date(dateStr + 'T00:00:00')
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        
        if (date.getTime() === today.getTime()) return 'Today'
        if (date.getTime() === yesterday.getTime()) return 'Yesterday'
        if (date.getTime() === tomorrow.getTime()) return 'Tomorrow'
        
        // Format as "Mon, Jan 15" or "Mon, Jan 15, 2024" if not this year
        const options = { weekday: 'short', month: 'short', day: 'numeric' }
        if (date.getFullYear() !== now.getFullYear()) {
            options.year = 'numeric'
        }
        return date.toLocaleDateString('en-US', options)
    }

    getColorPalette() {
        return {
            'Default': '#e5e7eb',
            'Gray': '#d1d5db',
            'Brown': '#e7d7c9',
            'Orange': '#fed7aa',
            'Yellow': '#fef3c7',
            'Lime': '#d9f99d',
            'Green': '#bbf7d0',
            'Teal': '#99f6e4',
            'Cyan': '#a5f3fc',
            'Blue': '#bfdbfe',
            'Indigo': '#c7d2fe',
            'Purple': '#e9d5ff',
            'Pink': '#fbcfe8',
            'Rose': '#fecdd3',
            'Red': '#fecaca',
            'Amber': '#fde68a'
        }
    }

    createOptionItem(value, onDelete, onChange, property) {
        const itemEl = document.createElement('div')
        itemEl.className = 'option-item'
        
        const input = document.createElement('input')
        input.type = 'text'
        input.value = value
        if (onChange) input.onchange = onChange
        
        const colorButton = document.createElement('button')
        colorButton.className = 'option-color-button'
        colorButton.type = 'button'
        const currentColor = property?.optionColors?.[value] || '#e5e7eb'
        colorButton.style.backgroundColor = currentColor
        
        const colorPalette = document.createElement('div')
        colorPalette.className = 'color-palette'
        
        const colors = this.getColorPalette()
        Object.entries(colors).forEach(([name, color]) => {
            const colorOption = document.createElement('button')
            colorOption.type = 'button'
            colorOption.className = 'color-option'
            colorOption.style.backgroundColor = color
            colorOption.title = name
            colorOption.onclick = () => {
                if (!property.optionColors) property.optionColors = {}
                property.optionColors[value] = color
                colorButton.style.backgroundColor = color
                colorPalette.classList.remove('open')
            }
            colorPalette.appendChild(colorOption)
        })
        
        colorButton.onclick = (e) => {
            e.stopPropagation()
            const isOpen = colorPalette.classList.contains('open')
            document.querySelectorAll('.color-palette').forEach(p => p.classList.remove('open'))
            if (!isOpen) {
                colorPalette.classList.add('open')
            }
        }
        
        const deleteBtn = document.createElement('button')
        deleteBtn.type = 'button'
        deleteBtn.textContent = '×'
        deleteBtn.onclick = onDelete
        
        const colorContainer = document.createElement('div')
        colorContainer.className = 'option-color-container'
        colorContainer.appendChild(colorButton)
        colorContainer.appendChild(colorPalette)
        
        itemEl.appendChild(input)
        itemEl.appendChild(colorContainer)
        itemEl.appendChild(deleteBtn)
        return itemEl
    }

    // ===== UI Rendering =====
    render() {
        this.renderBoard()
    }

    renderBoard() {
        const container = qs('#boardContainer')
        
        if (!this.viewState.groupBy) {
            container.innerHTML = `
                <div class="board-empty">
                    <div class="board-empty-icon">📋</div>
                    <div class="board-empty-title">No grouping selected</div>
                    <div class="board-empty-text">Select a field to group by from the dropdown above</div>
                </div>
            `
            return
        }

        const boardData = this.getColumns()
        if (!boardData) {
            container.innerHTML = '<div class="board-empty"><div class="board-empty-text">Select a valid grouping field</div></div>'
            return
        }

        const wrapper = document.createElement('div')
        wrapper.className = 'columns-wrapper'

        boardData.columnOrder.forEach(columnKey => {
            const column = boardData.columns[columnKey]
            const columnEl = this.createColumnElement(columnKey, column)
            wrapper.appendChild(columnEl)
        })

        container.innerHTML = ''
        container.appendChild(wrapper)
        this.setupSortables()
    }

    createColumnElement(columnKey, column) {
        const columnEl = document.createElement('div')
        columnEl.className = 'column'
        columnEl.dataset.columnKey = columnKey

        const header = document.createElement('div')
        header.className = 'column-header'
        
        const isEmptyColumn = columnKey === '__empty__'
        const titleClass = isEmptyColumn ? 'column-title column-title-empty' : 'column-title'
        
        header.innerHTML = `
            <div class="${titleClass}">
                ${column.label}
                <span class="column-count">${column.records.length}</span>
            </div>
        `

        const cardsList = document.createElement('div')
        cardsList.className = 'cards-list'
        cardsList.dataset.columnKey = columnKey

        column.records.forEach(record => {
            const cardEl = this.createCardElement(record)
            cardsList.appendChild(cardEl)
        })

        const newCardBtn = document.createElement('button')
        newCardBtn.className = 'new-card-button'
        newCardBtn.textContent = '+ New card'
        newCardBtn.onclick = () => {
            const record = this.createRecord()
            // Optionally set the groupBy field value
            if (this.viewState.groupBy && columnKey !== '__empty__') {
                this.setRecordPropertyValue(record.id, this.viewState.groupBy, columnKey)
            }
            this.openCardModal(record.id)
        }

        columnEl.appendChild(header)
        columnEl.appendChild(cardsList)
        columnEl.appendChild(newCardBtn)

        return columnEl
    }

    createCardElement(record) {
        const dragHandle = el('div', {
            class: 'card-drag-handle',
            html: '⋮⋮'
        })

        const title = el('div', {
            class: 'card-title',
            text: record.title || 'Untitled'
        })

        const contentWrapper = el('div', { class: 'card-content' }, title)

        const visibleProperties = this.schema.filter(p => p.visible && !p.isTitle)
        if (visibleProperties.length > 0) {
            const propsContainer = el('div', { class: 'card-properties-preview' })

            visibleProperties.forEach(property => {
                const value = record.values[property.id]
                if (value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)) {
                    const propEl = el('div', { class: 'card-property' })
                    
                    if (property.type === 'checkbox') {
                        const checkbox = el('span', {
                            class: value ? 'card-checkbox checked' : 'card-checkbox',
                            text: '✓'
                        })
                        const label = el('span', { text: property.name })
                        propEl.appendChild(checkbox)
                        propEl.appendChild(label)
                    } else if (property.type === 'select' || property.type === 'multi-select') {
                        const values = Array.isArray(value) ? value : [value]
                        values.forEach(val => {
                            const pill = el('span', { class: 'card-property-pill', text: val })
                            const color = property.optionColors?.[val]
                            if (color) {
                                pill.style.backgroundColor = color
                                pill.style.color = this.getContrastColor(color)
                            }
                            propEl.appendChild(pill)
                        })
                    } else if (Array.isArray(value)) {
                        propEl.textContent = value.join(', ')
                    } else if (property.type === 'date') {
                        propEl.textContent = this.formatDate(value)
                    } else {
                        propEl.textContent = String(value)
                    }

                    propsContainer.appendChild(propEl)
                }
            })

            if (propsContainer.children.length > 0) {
                contentWrapper.appendChild(propsContainer)
            }
        }

        const cardEl = el('div', {
            class: 'card',
            onclick: (e) => {
                if (e.target === dragHandle || dragHandle.contains(e.target)) return
                this.openCardModal(record.id)
            }
        }, dragHandle, contentWrapper)
        
        cardEl.dataset.recordId = record.id
        return cardEl
    }

    // ===== Modal Management =====
    openCardModal(recordId) {
        this.currentCardId = recordId
        const record = this.getRecord(recordId)
        if (!record) return

        const titleInput = qs('#cardTitle')
        titleInput.value = record.title

        const descriptionInput = qs('#cardDescription')
        descriptionInput.value = record.description || ''

        const container = qs('#cardPropertiesContainer')
        container.innerHTML = ''

        this.schema.forEach(property => {
            if (property.isTitle) return
            const fieldEl = this.createPropertyFieldElement(record, property)
            container.appendChild(fieldEl)
        })

        const modal = qs('#cardModal')
        modal.classList.remove('hidden')
    }

    createPropertyFieldElement(record, property) {
        const field = document.createElement('div')
        field.className = 'property-field'

        const header = document.createElement('div')
        header.className = 'property-field-header'

        const label = document.createElement('label')
        label.className = 'property-field-label'
        label.textContent = property.name
        label.onclick = () => this.openPropertyEditorModal(record, property)

        header.appendChild(label)
        field.appendChild(header)

        const valueContainer = document.createElement('div')
        valueContainer.className = 'property-field-value'

        switch (property.type) {
            case 'text':
                valueContainer.appendChild(this.createSimpleInput(record, property, 'text', i => i.value || null))
                break
            case 'number':
                valueContainer.appendChild(this.createSimpleInput(record, property, 'number', i => i.value ? Number(i.value) : null))
                break
            case 'date':
                valueContainer.appendChild(this.createSimpleInput(record, property, 'date', i => i.value || null))
                break
            case 'checkbox':
                valueContainer.appendChild(this.createSimpleInput(record, property, 'checkbox', i => i.checked ? true : false))
                break
            case 'select':
                valueContainer.appendChild(this.createSelectButtons(record, property, false))
                break
            case 'multi-select':
                valueContainer.appendChild(this.createSelectButtons(record, property, true))
                break
        }

        field.appendChild(valueContainer)
        return field
    }

    openPropertyEditorModal(record, property) {
        this.currentPropertyId = property.id

        const title = qs('#propertyEditorTitle')
        title.textContent = `Edit "${property.name}"`

        const nameInput = qs('#propertyNameInput')
        nameInput.value = property.name

        const typeSelect = qs('#propertyTypeSelect')
        typeSelect.value = property.type

        const optionsContainer = qs('#optionsContainer')
        if (this.isSelectType(property.type)) {
            optionsContainer.classList.remove('hidden')
            this.renderOptionsEditor(property)
        } else {
            optionsContainer.classList.add('hidden')
        }

        typeSelect.onchange = () => {
            if (this.isSelectType(typeSelect.value)) {
                optionsContainer.classList.remove('hidden')
                this.renderOptionsEditor({ ...property, type: typeSelect.value })
            } else {
                optionsContainer.classList.add('hidden')
            }
        }

        const modal = qs('#propertyEditorModal')
        modal.classList.remove('hidden')
    }

    renderOptionsEditor(property) {
        const optionsList = qs('#optionsList')
        optionsList.innerHTML = ''

        const options = property.options || []
        options.forEach((option, index) => {
            const itemEl = this.createOptionItem(
                option,
                () => {
                    options.splice(index, 1)
                    if (property.optionColors) {
                        delete property.optionColors[option]
                    }
                    this.renderOptionsEditor(property)
                },
                (e) => {
                    const oldValue = options[index]
                    const newValue = e.target.value
                    options[index] = newValue
                    // Update color mapping if it exists
                    if (property.optionColors && property.optionColors[oldValue]) {
                        property.optionColors[newValue] = property.optionColors[oldValue]
                        delete property.optionColors[oldValue]
                    }
                },
                property
            )
            optionsList.appendChild(itemEl)
        })
    }

    // ===== Settings Panel =====
    openSettingsPanel() {
        const panel = qs('#settingsPanel')
        panel.classList.remove('hidden')
        this.renderPropertiesSettings()
    }

    closeSettingsPanel() {
        const panel = qs('#settingsPanel')
        panel.classList.add('hidden')
    }

    renderPropertiesSettings() {
        const visibleList = qs('#visiblePropertiesList')
        const hiddenList = qs('#hiddenPropertiesList')

        visibleList.innerHTML = ''
        hiddenList.innerHTML = ''

        const visible = this.schema.filter(p => p.visible && !p.isTitle)
        const hidden = this.schema.filter(p => !p.visible && !p.isTitle)

        visible.forEach(property => {
            const item = this.createPropertySettingItem(property)
            visibleList.appendChild(item)
        })

        hidden.forEach(property => {
            const item = this.createPropertySettingItem(property)
            hiddenList.appendChild(item)
        })
    }

    createPropertySettingItem(property) {
        const item = document.createElement('div')
        item.className = 'property-item'
        item.draggable = true

        const label = document.createElement('span')
        label.className = 'property-item-label'
        label.textContent = property.name

        const toggle = document.createElement('input')
        toggle.type = 'checkbox'
        toggle.className = 'property-item-toggle'
        toggle.checked = property.visible
        toggle.onchange = () => {
            property.visible = toggle.checked
            this.saveToStorage()
            this.renderPropertiesSettings()
            this.renderBoard()
        }

        item.appendChild(label)
        item.appendChild(toggle)

        return item
    }

    // ===== Event Listeners =====
    setupEventListeners() {
        // Drag and drop for JSON import
        this.setupDragAndDrop()

        // Close color palettes when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.option-color-container')) {
                document.querySelectorAll('.color-palette').forEach(p => p.classList.remove('open'))
            }
        })

        // Toolbar
        qs('#groupBySelect').onchange = (e) => {
            this.viewState.groupBy = e.target.value || null
            this.saveToStorage()
            this.renderBoard()
            this.updateGroupByDropdown()
        }

        qs('#newCardBtn').onclick = () => {
            const record = this.createRecord()
            this.openCardModal(record.id)
        }

        qs('#settingsBtn').onclick = () => {
            this.openSettingsPanel()
        }

        qs('#closeSettingsBtn').onclick = () => {
            this.closeSettingsPanel()
        }

        qs('#hideAllBtn').onclick = () => {
            this.schema.forEach(property => {
                if (!property.isTitle) {
                    property.visible = false
                }
            })
            this.saveToStorage()
            this.renderPropertiesSettings()
            this.renderBoard()
        }

        qs('#showAllBtn').onclick = () => {
            this.schema.forEach(property => {
                property.visible = true
            })
            this.saveToStorage()
            this.renderPropertiesSettings()
            this.renderBoard()
        }

        qs('#exportBtn').onclick = () => {
            const json = this.exportToJSON()
            this.downloadJSON(json, `kanban-${this.getTimestampForFilename()}.json`)
        }

        qs('#importBtn').onclick = () => {
            qs('#fileInput').click()
        }

        qs('#fileInput').onchange = (e) => {
            const file = e.target.files[0]
            if (file) {
                const reader = new FileReader()
                reader.onload = (event) => {
                    this.importFromJSON(event.target.result)
                }
                reader.readAsText(file)
            }
            e.target.value = ''
        }

        qs('#themeToggleBtn').onclick = () => {
            this.toggleTheme()
        }

        qs('#deleteAllCardsBtn').onclick = () => {
            if (this.records.length === 0) {
                alert('No cards to delete')
                return
            }
            
            const count = this.records.length
            if (confirm(`Delete all ${count} ${this.pluralize(count, 'card')}? This cannot be undone.`)) {
                this.records = []
                this.saveToStorage()
                this.renderBoard()
            }
        }

        qs('#deleteDatabaseBtn').onclick = () => {
            const cardCount = this.records.length
            const propertyCount = this.schema.filter(p => !p.isTitle).length
            
            if (confirm(`Delete entire database?\n\nThis will remove:\n- ${cardCount} ${this.pluralize(cardCount, 'card')}\n- ${propertyCount} custom ${this.pluralize(propertyCount, 'property', 'properties')}\n- All settings\n\nThis cannot be undone.`)) {
                // Clear all data
                localStorage.removeItem('kanban_schema')
                localStorage.removeItem('kanban_records')
                localStorage.removeItem('kanban_view')
                
                // Reset to defaults
                this.schema = [this.createTitleProperty()]
                this.records = []
                this.viewState = { groupBy: null }
                
                this.saveToStorage()
                this.renderBoard()
                this.updateGroupByDropdown()
                
                alert('Database deleted. Starting fresh!')
            }
        }

        // Card Modal
        qs('#cardTitle').onchange = () => {
            if (this.currentCardId) {
                this.updateRecord(this.currentCardId, {
                    title: qs('#cardTitle').value || 'Untitled'
                })
                this.showSavedIndicator()
                this.renderBoard()
            }
        }

        qs('#cardDescription').onchange = () => {
            if (this.currentCardId) {
                this.updateRecord(this.currentCardId, {
                    description: qs('#cardDescription').value || ''
                })
                this.showSavedIndicator()
            }
        }

        qs('#deleteCardBtn').onclick = () => {
            if (!this.currentCardId) return
            const record = this.getRecord(this.currentCardId)
            if (!record) return
            
            if (confirm(`Delete "${record.title || 'Untitled'}"?`)) {
                this.deleteRecord(this.currentCardId)
                qs('#cardModal').classList.add('hidden')
                this.currentCardId = null
                this.renderBoard()
            }
        }

        qs('#addPropertyBtn').onclick = () => {
            MicroModal.show('propertyNameModal')
        }

        qs('#confirmPropertyNameBtn').onclick = () => {
            const name = qs('#newPropertyNameInput').value.trim()
            const type = qs('#newPropertyTypeSelect').value
            if (name) {
                const property = this.addProperty(name, type, [])
                if (this.isSelectType(type)) {
                    this.openPropertyEditorModal(null, property)
                }
                MicroModal.close('propertyNameModal')
                if (this.currentCardId) {
                    this.openCardModal(this.currentCardId)
                }
            }
        }

        qs('#newPropertyNameInput').onkeypress = (e) => {
            if (e.key === 'Enter') {
                qs('#confirmPropertyNameBtn').click()
            }
        }

        // Modal close handlers
        this.setupModalClose('#cardModal')
        this.setupModalClose('#propertyEditorModal')

        qs('#savePropertyBtn').onclick = () => {
            if (!this.currentPropertyId) return

            const property = this.getProperty(this.currentPropertyId)
            if (!property) return

            const name = qs('#propertyNameInput').value
            const type = qs('#propertyTypeSelect').value
            
            let options = []
            if (this.isSelectType(type)) {
                const optionInputs = qsa('#optionsList input[type="text"]')
                options = Array.from(optionInputs).map(input => input.value).filter(v => v)
            }

            // Include optionColors in the update
            this.updateProperty(this.currentPropertyId, { 
                name, 
                type, 
                options,
                optionColors: property.optionColors || {}
            })
            this.closeModal('#propertyEditorModal')
            
            this.updateGroupByDropdown()
            
            if (this.currentCardId) {
                this.openCardModal(this.currentCardId)
            }
            this.renderBoard()
        }

        qs('#addOptionBtn').onclick = () => {
            if (!this.currentPropertyId) return
            const property = this.getProperty(this.currentPropertyId)
            if (!property) return
            
            const optionsList = qs('#optionsList')
            const itemEl = this.createOptionItem('New option', () => itemEl.remove(), null, property)
            const input = itemEl.querySelector('input[type="text"]')
            optionsList.appendChild(itemEl)
            input.focus()
            input.select()
        }

        qs('#duplicatePropertyBtn').onclick = () => {
            if (!this.currentPropertyId) return
            const property = this.getProperty(this.currentPropertyId)
            if (!property) return

            const newProperty = this.addProperty(
                property.name + ' (copy)',
                property.type,
                property.options ? [...property.options] : []
            )

            qs('#propertyEditorModal').classList.add('hidden')
            if (this.currentCardId) {
                this.openCardModal(this.currentCardId)
            }
        }

        qs('#deletePropertyBtn').onclick = () => {
            if (!this.currentPropertyId) return
            const property = this.getProperty(this.currentPropertyId)
            if (!property || property.isTitle) {
                alert('Cannot delete the Title field')
                return
            }

            if (confirm(`Delete property "${property.name}"?`)) {
                this.deleteProperty(this.currentPropertyId)
                qs('#propertyEditorModal').classList.add('hidden')
                if (this.currentCardId) {
                    this.openCardModal(this.currentCardId)
                }
                this.renderBoard()
            }
        }

        this.updateGroupByDropdown()
    }

    updateGroupByDropdown() {
        const select = qs('#groupBySelect')
        select.innerHTML = '<option value="">Select a field to group by...</option>'

        this.getGroupableProperties().forEach(property => {
            const option = document.createElement('option')
            option.value = property.id
            option.textContent = property.name
            select.appendChild(option)
        })

        if (this.viewState.groupBy) {
            select.value = this.viewState.groupBy
        }
    }

    showImportConfirmation(file) {
        const cardCount = this.records.length
        const propertyCount = this.schema.filter(p => !p.isTitle).length
        
        const bodyContent = [
            el('p', { 
                class: 'import-warning',
                text: 'This will replace your current database:'
            }),
            el('ul', { class: 'import-stats' },
                el('li', { text: `${cardCount} ${this.pluralize(cardCount, 'card')}` }),
                el('li', { text: `${propertyCount} custom ${this.pluralize(propertyCount, 'property', 'properties')}` })
            ),
            el('p', { 
                class: 'import-info',
                text: 'Would you like to download a backup before importing?'
            })
        ]
        
        const actions = [
            el('button', { 
                class: 'btn',
                text: 'Cancel',
                onclick: () => this.closeModal(modal)
            }),
            el('button', { 
                class: 'btn btn-secondary',
                text: 'Download current & import',
                onclick: () => {
                    this.downloadCurrentDatabase()
                    this.loadFromFile(file)
                    this.closeModal(modal)
                }
            }),
            el('button', { 
                class: 'btn btn-primary',
                text: 'Import without backup',
                onclick: () => {
                    this.loadFromFile(file)
                    this.closeModal(modal)
                }
            })
        ]
        
        const modal = this.createModal('Import database?', bodyContent, actions)
        modal.classList.add('import-confirmation-modal')
        document.body.appendChild(modal)
    }

    downloadCurrentDatabase() {
        const json = this.exportToJSON()
        this.downloadJSON(json, `kanban-backup-${this.getTimestampForFilename()}.json`)
    }

    loadFromFile(file) {
        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result)
                this.validateImportData(data)
                
                this.schema = data.schema
                this.records = data.records
                this.viewState = data.viewState || { groupBy: null }
                this.saveToStorage()
                this.updateGroupByDropdown()
                this.render()
                
                const cardCount = this.records.length
                alert(`Database loaded successfully!\n${cardCount} ${this.pluralize(cardCount, 'card')} imported`)
            } catch (error) {
                alert('Error loading JSON: ' + error.message)
            }
        }
        reader.readAsText(file)
    }

    setupDragAndDrop() {
        const body = document.body
        
        // Check if drag contains files
        const hasFiles = (e) => {
            return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')
        }
        
        // Prevent default drag behaviors only for file drops
        ;['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            body.addEventListener(eventName, (e) => {
                if (hasFiles(e)) {
                    e.preventDefault()
                    e.stopPropagation()
                }
            }, false)
        })

        // Add visual feedback on drag only for file drops
        body.addEventListener('dragenter', (e) => {
            if (hasFiles(e)) {
                body.classList.add('drag-active')
            }
        })

        body.addEventListener('dragleave', (e) => {
            if (hasFiles(e) && e.target === body) {
                body.classList.remove('drag-active')
            }
        })

        body.addEventListener('drop', (e) => {
            if (!hasFiles(e)) return
            
            body.classList.remove('drag-active')
            
            const files = e.dataTransfer.files
            if (files.length === 0) return

            const file = files[0]
            
            // Check if it's a JSON file
            if (!file.name.endsWith('.json')) {
                alert('Please drop a JSON file')
                return
            }

            // Show confirmation modal
            this.showImportConfirmation(file)
        })
    }

    setupSortables() {
        // Setup column reordering
        const columnsWrapper = qs('.columns-wrapper')
        if (columnsWrapper) {
            Sortable.create(columnsWrapper, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.column-header',
                onEnd: (evt) => {
                    if (!this.viewState.groupBy) return
                    const property = this.getProperty(this.viewState.groupBy)
                    if (!property) return
                    
                    // Get new column order
                    const columns = Array.from(columnsWrapper.querySelectorAll('.column'))
                    const newOrder = columns.map(col => col.dataset.columnKey).filter(key => key !== '__empty__')
                    
                    // Save the order
                    property.columnOrder = newOrder
                    this.saveToStorage()
                }
            })
        }

        // Setup card reordering within columns
        const lists = qsa('.cards-list')
        lists.forEach(list => {
            Sortable.create(list, {
                group: 'cards',
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.card-drag-handle',
                onEnd: (evt) => {
                    const recordId = evt.item.dataset.recordId
                    const sourceColumn = evt.from.dataset.columnKey
                    const destColumn = evt.to.dataset.columnKey

                    const record = this.getRecord(recordId)
                    if (!record) return

                    // Update groupBy field if moving between columns
                    if (sourceColumn !== destColumn && this.viewState.groupBy) {
                        if (destColumn === '__empty__') {
                            this.setRecordPropertyValue(recordId, this.viewState.groupBy, null)
                        } else {
                            this.setRecordPropertyValue(recordId, this.viewState.groupBy, destColumn)
                        }
                    }

                    // Update positions within column
                    const cardsInDest = Array.from(evt.to.querySelectorAll('.card'))
                    cardsInDest.forEach((cardEl, index) => {
                        const id = cardEl.dataset.recordId
                        const rec = this.getRecord(id)
                        if (rec) {
                            rec.position = index
                        }
                    })

                    this.saveToStorage()
                    this.render()
                }
            })
        })
    }

    // ===== Utility =====
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2)
    }

    pluralize(count, singular, plural = null) {
        if (count === 1) return singular
        return plural || singular + 's'
    }

    getTimestampForFilename() {
        const now = new Date()
        const date = now.toISOString().split('T')[0]
        const time = now.toTimeString().slice(0, 5).replace(':', '-')
        return `${date}-${time}`
    }

    downloadJSON(data, filename) {
        const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        URL.revokeObjectURL(url)
    }

    isSelectType(type) {
        return type === 'select' || type === 'multi-select'
    }

    validateImportData(data) {
        if (!data.schema || !data.records) {
            throw new Error('Invalid JSON format: missing schema or records')
        }
        return true
    }

    closeModal(modal) {
        if (typeof modal === 'string') {
            const modalEl = qs(modal)
            if (modalEl) modalEl.classList.add('hidden')
        } else {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal)
            }
        }
    }

    createModal(title, bodyContent, actions) {
        const modal = el('div', { class: 'modal' })
        const overlay = el('div', { class: 'modal-overlay' })
        const content = el('div', { class: 'modal-content modal-content-sm' })
        
        const header = el('div', { class: 'modal-header' }, el('h2', { text: title }))
        const body = el('div', { class: 'modal-body' }, ...bodyContent)
        const actionContainer = el('div', { class: 'form-actions' }, ...actions)
        
        content.appendChild(header)
        content.appendChild(body)
        content.appendChild(actionContainer)
        
        modal.appendChild(overlay)
        modal.appendChild(content)
        
        overlay.onclick = () => this.closeModal(modal)
        
        return modal
    }
}

// Initialize app when DOM is ready
ready(() => {
    window.app = new KanbanApp()
})
