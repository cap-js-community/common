using from '@sap/cds-common-content';
using {
    Currency,
    managed,
} from '@sap/cds/common';

namespace test;

@cds.replicate
entity Books : managed {
    key ID       : Integer;
        title    : localized String       @mandatory;
        descr    : localized String;
        author   : Association to Authors @mandatory;
        stock    : Integer;
        price    : Decimal;
        currency : Currency;
        image    : LargeBinary            @Core.MediaType: 'image/png';
        pages    : Composition of many Pages
                       on pages.book = $self;
}

@cds.replicate: {
    ttl: 1000000,
    preload: true
}
entity Pages {
    key ID      : Integer;
        book    : Association to Books;
        no      : Integer;
        content : LargeString;
        quotes  : Composition of many Quotes
                      on quotes.page = $self;
}

entity PagesView as select from Pages mixin {
    mixinBook    : Association to Books on ID = ID;
} into {
    *,
    mixinBook
} where mixinBook.ID = ID;

entity EnumView as select from Enum as enums join Books on 1 = 1 {
    enums.*
};

@cds.replicate
entity Authors : managed {
    key ID           : Integer;
        name         : String(111) @mandatory;
        dateOfBirth  : Date;
        dateOfDeath  : Date;
        placeOfBirth : String;
        placeOfDeath : String;
        books        : Association to many Books
                           on books.author = $self;
}

entity Quotes {
    key ID   : Integer;
        page : Association to Pages;
        line : Integer;
        text : String;
}

@cds.replicate.static
entity Enum {
    key name : String;
        descr : String;
}

// entity annotation stub
entity Dummy {
    key ID   : String;
        name : String not null;
        number : Decimal(10, 10);
        localizedName : localized String not null;
        released : String;
        unmanaged : Association to Books on unmanaged.ID = $self.ID;
        managed : Association to Books;
        test : Association to Test;
        virtual virtualField : String;
        text : String(255);
        // entity element stub
}

@fiori.draft.enabled
entity Draft {
    key ID   : String;
        name : String not null;
}

@assert.unique.default: [magicKey]
// entity index stub
entity Test {
    key magicKey : String;
        name : String not null;
}

// entity stub
