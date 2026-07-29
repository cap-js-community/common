using TestBetterAnnotationsService as service;

// Books: List Report + Object Page (with Pages as child)
annotate service.Books with @UI: {
  SelectionFields: [ title ],
  HeaderInfo: {
    TypeName: 'Book',
    TypeNamePlural: 'Books',
    Title: { Value: title }
  },
  Facets: [
    { $Type: 'UI.ReferenceFacet', Target: 'pages/@UI.LineItem', Label: 'Pages' }
  ]
};

annotate service.Pages with @UI: {
  HeaderInfo: {
    TypeName: 'Page',
    TypeNamePlural: 'Pages',
    Title: { Value: content }
  }
};
