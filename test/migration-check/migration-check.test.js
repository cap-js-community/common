"use strict";

const cds = require("@sap/cds");
const shelljs = require("shelljs");
const fs = require("fs");
const path = require("path");

const { MigrationCheck } = require("../../src/migration-check/");

const { test } = cds.test(__dirname + "/../..");

process.env.PORT = 0; // Random

cds.env.migrationCheck.baseDir = "temp/migration";

const migrationCheck = new MigrationCheck();

describe("Migration Check", () => {
  function cleanup() {
    const genPath = path.join(process.cwd(), "gen");
    if (fs.existsSync(genPath)) {
      fs.rmdirSync(genPath, { recursive: true });
    }
    const migrationPath = path.join(process.cwd(), cds.env.migrationCheck.baseDir);
    if (fs.existsSync(migrationPath)) {
      fs.rmdirSync(migrationPath, { recursive: true });
    }
  }

  beforeEach(async () => {
    cleanup();
    migrationCheck.options.freeze = false;
    migrationCheck.setup();
    await test.data.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("Check - No build CSN", async () => {
    const result = migrationCheck.check();
    expect(result).toEqual({
      messages: [
        {
          code: "NoValidBuildCSN",
          severity: "error",
          text: "No valid build CSN found for CSN build path. Migration check cannot be started. Execute 'cds build --production' before",
        },
      ],
      success: false,
    });
  });

  it("Check - No prod CSN", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "NoProdCSNMigrationSkipped",
          severity: "info",
          text: expect.stringMatching(
            /No valid production CSN found for path '.*temp\/migration\/csn-prod.json'. Execute 'cdsmc -u' to update production CSN. Migration check is skipped./,
          ),
        },
      ],
      success: true,
    });
  });

  it("Check - Invalid prod CSN hash (checksum)", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const csnProdHash = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod-hash.json");
    fs.writeFileSync(
      csnProdHash,
      JSON.stringify({
        description: "xxx",
        checksum: "yyy",
        "checksum-sha1": "zzz",
      }),
    );
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "HashMismatch",
          severity: "error",
          text: expect.stringMatching(/Hash mismatch\. Production CSN is protected: .* <> yyy/),
        },
      ],
      success: false,
    });
  });

  it("Check - Compatible change (entity) - not whitelisted", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `namespace test;

entity Foo {
    name: String;
}`,
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "NewEntityIsNotWhitelisted",
          element: undefined,
          entity: "test.Foo",
          severity: "error",
          text: "The new entity is not whitelisted: test.Foo",
        },
      ],
      success: false,
    });
  });

  it("Check - Compatible change (element) - not whitelisted", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `using test.Books from './schema';

extend entity Books {
    color: String;
}`,
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "NewEntityElementIsNotWhitelisted",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Books.color",
        },
      ],
      success: false,
    });
  });

  it("Check - Compatible change - whitelist not necessary", async () => {
    migrationCheck.options.whitelist = false;
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `using test.Books from './schema';

extend entity Books {
    color: String;
}`,
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    migrationCheck.options.whitelist = true;
  });

  it("Check - Compatible change (entity) - whitelisted", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `namespace test;

entity Foo {
    name: String;
}`,
    );
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.Foo": {},
        },
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Check - Compatible change (element) - whitelisted", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `using test.Books from './schema';

extend entity Books {
    color: String;
}`,
    );
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.Books": {
            elements: {
              color: {},
            },
          },
        },
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Check - Compatible change - freeze", async () => {
    migrationCheck.options.freeze = true;
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update(true);
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `using test.Books from './schema';

extend entity Books {
    color: String;
}`,
    );
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.Books": {
            elements: {
              color: {},
            },
          },
        },
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    migrationCheck.options.freeze = false;
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "HashMismatch",
          severity: "error",
          text: expect.stringMatching(
            /Hash mismatch. Production CSN Whitelist is protected \(Persistence Freeze\): (.*) <> (.*)/,
          ),
        },
      ],
      success: false,
    });
  });

  it("Check - Compatible change - invalid whitelist hash (checksum)", async () => {
    migrationCheck.options.freeze = true;
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update(true);
    const extensionPath = path.join(process.cwd(), "db", "extension.cds");
    fs.writeFileSync(
      extensionPath,
      `using test.Books from './schema';

extend entity Books {
    color: String;
}`,
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.rmSync(extensionPath);
    migrationCheck.options.freeze = false;
    const whitelistHashPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist-hash.json",
    );
    fs.writeFileSync(
      whitelistHashPath,
      JSON.stringify({
        description: "xxx",
        checksum: "yyy",
        "checksum-sha1": "zzz",
      }),
    );
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "HashMismatch",
          severity: "error",
          text: expect.stringMatching(
            /Hash mismatch. Production CSN Whitelist is protected \(Persistence Freeze\): (.*) <> (.*)/,
          ),
        },
      ],
      success: false,
    });
  });

  it("Check - Incompatible change", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const schemaPath = path.join(process.cwd(), "db", "schema.cds");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    const schemaModified = schema.replace("title    : localized String", "title    : localized String(10)");
    fs.writeFileSync(schemaPath, schemaModified);
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.Books": {
            elements: {
              title: {},
            },
          },
        },
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.writeFileSync(schemaPath, schema);
    const result = migrationCheck.check();
    expect(result).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.title",
        },
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books.texts",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.texts.title",
        },
      ],
      success: false,
    });
  });

  it("Check - Incompatible change - admin hash", async () => {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const schemaPath = path.join(process.cwd(), "db", "schema.cds");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    const schemaModified = schema.replace("title    : localized String", "title    : localized String(10)");
    fs.writeFileSync(schemaPath, schemaModified);
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.Books": {
            elements: {
              title: {},
            },
          },
        },
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.writeFileSync(schemaPath, schema);
    let result = migrationCheck.check(true);
    expect(result).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.title",
        },
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books.texts",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.texts.title",
        },
      ],
      success: false,
    });
    expect(result.adminHash).toBeDefined();
    migrationCheck.options.adminHash = result.adminHash;
    result = migrationCheck.check(true);
    expect(result).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books",
          severity: "warning",
          text: "The data type of a released element cannot be shortened: test.Books.title",
        },
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books.texts",
          severity: "warning",
          text: "The data type of a released element cannot be shortened: test.Books.texts.title",
        },
        {
          code: "AcceptedByAdmin",
          severity: "info",
          text: "Migration check errors accepted by admin",
        },
      ],
      success: true,
    });
    migrationCheck.options.adminHash = "XXX";
    result = migrationCheck.check(true);
    delete migrationCheck.options.adminHash;
    expect(result).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.title",
        },
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "title",
          entity: "test.Books.texts",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Books.texts.title",
        },
        {
          code: "AdminHashInvalid",
          severity: "error",
          text: "Admin hash is not valid for current migration check state",
        },
      ],
      success: false,
    });
  });

  it("Update - No build CSN", async () => {
    const result = migrationCheck.update();
    expect(result).toEqual({
      messages: [
        {
          code: "NoValidBuildCSN",
          severity: "error",
          text: "No valid build CSN found for CSN build path. Migration update cannot be started. Execute 'cds build --production' before",
        },
      ],
      success: false,
    });
  });

  it("Update - update prod CSN", async () => {
    shelljs.exec("cds build --production", { silent: true });
    const result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const csnProd = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod.json");
    expect(JSON.parse(fs.readFileSync(csnProd)).definitions).toBeDefined();
    const csnProdHash = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod-hash.json");
    expect(JSON.parse(fs.readFileSync(csnProdHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    const migrationExtensionWhitelist = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelist))).toMatchObject({
      definitions: {},
    });
    const migrationExtensionWhitelistHash = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist-hash.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelistHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
  });

  it("Update - Label", async () => {
    migrationCheck.options.label = "Release 1.0.0";
    shelljs.exec("cds build --production", { silent: true });
    const result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const csnProd = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod.json");
    expect(JSON.parse(fs.readFileSync(csnProd)).definitions).toBeDefined();
    const csnProdHash = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod-hash.json");
    expect(JSON.parse(fs.readFileSync(csnProdHash))).toMatchObject({
      description: expect.stringMatching(/Release 1\.0\.0 \(.*\)/),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    const migrationExtensionWhitelistHash = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist-hash.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelistHash))).toMatchObject({
      description: expect.stringMatching(/Release 1\.0\.0 \(.*\)/),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    migrationCheck.options.label = null;
  });

  it("Update - Clear whitelist", async () => {
    shelljs.exec("cds build --production", { silent: true });
    let result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.XXX": {
            elements: {
              yyy: {},
            },
          },
        },
      }),
    );
    result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const csnProd = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod.json");
    expect(JSON.parse(fs.readFileSync(csnProd)).definitions).toBeDefined();
    const csnProdHash = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod-hash.json");
    expect(JSON.parse(fs.readFileSync(csnProdHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    const migrationExtensionWhitelist = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelist))).toMatchObject({
      definitions: {},
    });
    const migrationExtensionWhitelistHash = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist-hash.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelistHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
  });

  it("Update - Keep whitelist", async () => {
    migrationCheck.options.keep = true;
    shelljs.exec("cds build --production", { silent: true });
    let result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: {
          "test.XXX": {
            elements: {
              yyy: {},
            },
          },
        },
      }),
    );
    result = migrationCheck.update();
    expect(result).toMatchObject({
      messages: [],
      success: true,
    });
    const csnProd = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod.json");
    expect(JSON.parse(fs.readFileSync(csnProd)).definitions).toBeDefined();
    const csnProdHash = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod-hash.json");
    expect(JSON.parse(fs.readFileSync(csnProdHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    const migrationExtensionWhitelist = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelist))).toMatchObject({
      definitions: {
        "test.XXX": {
          elements: {
            yyy: {},
          },
        },
      },
    });
    const migrationExtensionWhitelistHash = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist-hash.json",
    );
    expect(JSON.parse(fs.readFileSync(migrationExtensionWhitelistHash))).toMatchObject({
      description: expect.any(String),
      checksum: expect.any(String),
      "checksum-sha1": expect.any(String),
    });
    migrationCheck.options.keep = false;
  });

  it("Update - Admin freeze", async () => {
    migrationCheck.options.freeze = true;
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update(true);
    const freezePath = path.join(process.cwd(), cds.env.migrationCheck.baseDir, "csn-prod.freeze");
    expect(fs.existsSync(freezePath)).toBe(true);
    migrationCheck.options.freeze = false;
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update(true);
    expect(fs.existsSync(freezePath)).toBe(false);
  });

  it("Validate - ReleasedEntityCannotBeRemoved", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("entity Dummy {", "entity Dummy2 {"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedEntityCannotBeRemoved",
          element: undefined,
          entity: "test.Dummy",
          severity: "error",
          text: "A released entity cannot be removed: test.Dummy",
        },
        {
          code: "ReleasedEntityCannotBeRemoved",
          element: undefined,
          entity: "test.Dummy.texts",
          severity: "error",
          text: "A released entity cannot be removed: test.Dummy.texts",
        },
        {
          code: "NewEntityIsNotWhitelisted",
          element: undefined,
          entity: "test.Dummy2",
          severity: "error",
          text: "The new entity is not whitelisted: test.Dummy2",
        },
        {
          code: "NewEntityIsNotWhitelisted",
          element: undefined,
          entity: "test.Dummy2.texts",
          severity: "error",
          text: "The new entity is not whitelisted: test.Dummy2.texts",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedEntityDraftEnablementCannotBeChanged", async () => {
    expect(
      validateModification((schema, service) => {
        return {
          service: service.replace("@odata.draft.enabled", ""),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedEntityDraftEnablementCannotBeChanged",
          element: undefined,
          entity: "TestService.Draft",
          severity: "error",
          text: "The draft enablement state of a released entity cannot be changed: TestService.Draft",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementCannotBeRemoved", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("released : String;", ""),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementCannotBeRemoved",
          element: "released",
          entity: "test.Dummy",
          severity: "error",
          text: "A released element cannot be removed: test.Dummy.released",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementKeyCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("key ID   : String;", "ID   : String;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementKeyCannotBeChanged",
          element: "ID",
          entity: "test.Dummy",
          severity: "error",
          text: "The key of a released element cannot be changed: test.Dummy.ID",
        },
        {
          code: "ReleasedEntityCannotBeRemoved",
          element: undefined,
          entity: "test.Dummy.texts",
          severity: "error",
          text: "A released entity cannot be removed: test.Dummy.texts",
        },
      ],
      success: false,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "key name : String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementKeyCannotBeChanged",
          element: "name",
          entity: "test.Dummy",
          severity: "error",
          text: "The key of a released element cannot be changed: test.Dummy.name",
        },
        {
          code: "NewEntityElementIsNotWhitelisted",
          element: "name",
          entity: "test.Dummy.texts",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Dummy.texts.name",
        },
        {
          code: "NewEntityElementNotNullableDefault",
          element: "name",
          entity: "test.Dummy.texts",
          severity: "error",
          text: "A new entity element must have a default value if it is not nullable: test.Dummy.texts.name",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementManagedUnmanagedCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace(
            "unmanaged : Association to Books on unmanaged.ID = $self.ID;",
            "unmanaged : Association to Books;",
          ),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementManagedUnmanagedCannotBeChanged",
          element: "unmanaged",
          entity: "test.Dummy",
          severity: "error",
          text: "The managed/unmanaged state of a released element cannot be changed: test.Dummy.unmanaged",
        },
      ],
      success: false,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace(
            "managed : Association to Books;",
            "managed : Association to Books on managed.ID = $self.ID;",
          ),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementManagedUnmanagedCannotBeChanged",
          element: "managed",
          entity: "test.Dummy",
          severity: "error",
          text: "The managed/unmanaged state of a released element cannot be changed: test.Dummy.managed",
        },
        {
          code: "ReleasedElementOnConditionCannotBeChanged",
          element: "managed",
          entity: "test.Dummy",
          severity: "error",
          text: "The ON condition of a released element cannot be changed: test.Dummy.managed",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementVirtualCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "virtual name : String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementVirtualCannotBeChanged",
          element: "name",
          entity: "test.Dummy",
          severity: "error",
          text: "The virtual state of a released element cannot be changed: test.Dummy.name",
        },
      ],
      success: false,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("virtual virtualField : String;", "virtualField : String;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementVirtualCannotBeChanged",
          element: "virtualField",
          entity: "test.Dummy",
          severity: "error",
          text: "The virtual state of a released element cannot be changed: test.Dummy.virtualField",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementLocalizationCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("localizedName : localized String not null;", "localizedName : String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementLocalizationCannotBeChanged",
          element: "localizedName",
          entity: "test.Dummy",
          severity: "error",
          text: "The localization state of a released element cannot be changed: test.Dummy.localizedName",
        },
        {
          code: "ReleasedEntityCannotBeRemoved",
          element: undefined,
          entity: "test.Dummy.texts",
          severity: "error",
          text: "A released entity cannot be removed: test.Dummy.texts",
        },
      ],
      success: false,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "name : localized String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "NewEntityElementIsNotWhitelisted",
          element: "name",
          entity: "test.Dummy.texts",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Dummy.texts.name",
        },
        {
          code: "NewEntityElementNotNullableDefault",
          element: "name",
          entity: "test.Dummy.texts",
          severity: "error",
          text: "A new entity element must have a default value if it is not nullable: test.Dummy.texts.name",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementNullableCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "name : String;"),
        };
      }),
    ).toMatchObject({
      messages: [],
      success: true,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("released : String;", "released : String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementNullableCannotBeChanged",
          element: "released",
          entity: "test.Dummy",
          severity: "error",
          text: "A released element cannot be changed to not-nullable: test.Dummy.released",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementTypeCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "name : Integer not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeChanged",
          element: "name",
          entity: "test.Dummy",
          severity: "error",
          text: "The data type of a released element cannot be changed: test.Dummy.name",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementTypeCannotBeShortened", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("name : String not null;", "name : String(1) not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeCannotBeShortened",
          element: "name",
          entity: "test.Dummy",
          severity: "error",
          text: "The data type of a released element cannot be shortened: test.Dummy.name",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementScalePrecisionCannotBeLower", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("number : Decimal(10, 10);", "number : Decimal(1, 1);"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementScalePrecisionCannotBeLower",
          element: "number",
          entity: "test.Dummy",
          severity: "error",
          text: "The scale or precision of a released element cannot be reduced: test.Dummy.number",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementTargetCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("managed : Association to Books;", "managed : Association to Quotes;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTargetCannotBeChanged",
          element: "managed",
          entity: "test.Dummy",
          severity: "error",
          text: "The target of a released element cannot be changed: test.Dummy.managed",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementCardinalityCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("managed : Association to Books;", "managed : Association to many Books;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementManagedUnmanagedCannotBeChanged",
          element: "managed",
          entity: "test.Dummy",
          severity: "error",
          text: "The managed/unmanaged state of a released element cannot be changed: test.Dummy.managed",
        },
        {
          code: "ReleasedElementCardinalityCannotBeChanged",
          element: "managed",
          entity: "test.Dummy",
          severity: "error",
          text: "The cardinality of a released element cannot be changed: test.Dummy.managed",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedElementOnConditionCannotBeChanged", async () => {
    // Unmanaged on condition allowed
    expect(
      validateModification((schema) => {
        return {
          schema,
        };
      }),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - ReleasedElementKeysConditionCannotBeChanged", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("key magicKey : String;", "key magicKey2 : String;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementKeysConditionCannotBeChanged",
          element: "test",
          entity: "test.Dummy",
          severity: "error",
          text: "The keys condition of a released element cannot be changed: test.Dummy.test",
        },
        {
          code: "ReleasedElementCannotBeRemoved",
          element: "magicKey",
          entity: "test.Test",
          severity: "error",
          text: "A released element cannot be removed: test.Test.magicKey",
        },
        {
          code: "NewEntityElementIsNotWhitelisted",
          element: "magicKey2",
          entity: "test.Test",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Test.magicKey2",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedEntityIndexChangeIsNotAllowed", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("@assert.unique.default: [magicKey]", "@assert.unique.default: [name]"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedEntityIndexChangeIsNotAllowed",
          element: undefined,
          entity: "test.Test",
          severity: "error",
          text: "Changes to the index of a released entity are not allowed: test.Test",
        },
        {
          code: "ReleasedEntityIndexChangeIsNotWhitelisted",
          element: undefined,
          entity: "test.Test",
          severity: "error",
          text: "Changes to the index of a released entity must be whitelisted: test.Test",
        },
      ],
      success: false,
    });
  });

  it("Validate - ReleasedEntityIndexChangeIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("@assert.unique.default: [magicKey]", "@assert.unique.default: [magicKey, name]"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedEntityIndexChangeIsNotWhitelisted",
          element: undefined,
          entity: "test.Test",
          severity: "error",
          text: "Changes to the index of a released entity must be whitelisted: test.Test",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("@assert.unique.default: [magicKey]", "@assert.unique.default: [magicKey, name]"),
          };
        },
        {
          "test.Test": {
            elements: {},
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - ReleasedElementTypeExtensionIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("text : String(255);", "text : String(500);"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementTypeExtensionIsNotWhitelisted",
          element: "text",
          entity: "test.Dummy",
          severity: "error",
          text: "Extending the type of a released element requires whitelisting: test.Dummy.text",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("text : String(255);", "text : String(500);"),
          };
        },
        {
          "test.Dummy": {
            elements: {
              text: {},
            },
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - ReleasedElementScalePrecisionExtensionIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("number : Decimal(10, 10);", "number : Decimal(11, 11);"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementScalePrecisionExtensionIsNotWhitelisted",
          element: "number",
          entity: "test.Dummy",
          severity: "error",
          text: "Extending the scale or precision of a released element requires whitelisting: test.Dummy.number",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("number : Decimal(10, 10);", "number : Decimal(11, 11);"),
          };
        },
        {
          "test.Dummy": {
            elements: {
              number: {},
            },
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - NewEntityIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("// entity stub", "entity NewEntity { key ID : String; }"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "NewEntityIsNotWhitelisted",
          element: undefined,
          entity: "test.NewEntity",
          severity: "error",
          text: "The new entity is not whitelisted: test.NewEntity",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("// entity stub", "entity NewEntity { key ID : String; }"),
          };
        },
        {
          "test.NewEntity": {
            elements: {},
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - NewEntityElementIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("// entity element stub", "newElement: String;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "NewEntityElementIsNotWhitelisted",
          element: "newElement",
          entity: "test.Dummy",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Dummy.newElement",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("// entity element stub", "newElement: String;"),
          };
        },
        {
          "test.Dummy": {
            elements: {
              newElement: {},
            },
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - NewEntityElementNotNullableDefault", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("// entity element stub", "newElement: String not null;"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "NewEntityElementIsNotWhitelisted",
          element: "newElement",
          entity: "test.Dummy",
          severity: "error",
          text: "The new entity element is not whitelisted: test.Dummy.newElement",
        },
        {
          code: "NewEntityElementNotNullableDefault",
          element: "newElement",
          entity: "test.Dummy",
          severity: "error",
          text: "A new entity element must have a default value if it is not nullable: test.Dummy.newElement",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("// entity element stub", "newElement: String not null default 'A';"),
          };
        },
        {
          "test.Dummy": {
            elements: {
              newElement: {},
            },
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - NewEntityIndexIsNotWhitelisted", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("// entity index stub", "@assert.unique.name: [name]"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "NewEntityIndexIsNotWhitelisted",
          element: undefined,
          entity: "test.Test",
          severity: "error",
          text: "The new entity index is not whitelisted: test.Test",
        },
      ],
      success: false,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema.replace("// entity index stub", "@assert.unique.name: [name]"),
          };
        },
        {
          "test.Test": {
            elements: {},
          },
        },
      ),
    ).toMatchObject({
      messages: [],
      success: true,
    });
  });

  it("Validate - ReleasedEntityJournalModeAndEntityChangeIsNotAllowed", async () => {
    expect(
      validateModification((schema) => {
        return {
          schema: schema.replace("// entity annotation stub", "@cds.persistence.journal"),
        };
      }),
    ).toMatchObject({
      messages: [],
      success: true,
    });
    expect(
      validateModification(
        (schema) => {
          return {
            schema: schema
              .replace("// entity annotation stub", "@cds.persistence.journal")
              .replace("// entity element stub", "newElement: String;"),
          };
        },
        {
          "test.Dummy": {
            elements: {
              newElement: {},
            },
          },
        },
      ),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedEntityJournalModeAndEntityChangeIsNotAllowed",
          element: undefined,
          entity: "test.Dummy",
          severity: "error",
          text: "Enabling journal mode and changing entity in same cycle is not allowed: test.Dummy",
        },
      ],
      success: false,
    });
    expect(
      validateModification((schema) => {
        return {
          schema: schema
            .replace("// entity annotation stub", "@cds.persistence.journal")
            .replace("number : Decimal(10, 10);", "number : Decimal(1, 1);"),
        };
      }),
    ).toMatchObject({
      messages: [
        {
          code: "ReleasedElementScalePrecisionCannotBeLower",
          element: "number",
          entity: "test.Dummy",
          severity: "error",
          text: "The scale or precision of a released element cannot be reduced: test.Dummy.number",
        },
        {
          code: "ReleasedEntityJournalModeAndEntityChangeIsNotAllowed",
          element: undefined,
          entity: "test.Dummy",
          severity: "error",
          text: "Enabling journal mode and changing entity in same cycle is not allowed: test.Dummy",
        },
      ],
      success: false,
    });
  });

  function validateModification(cb, whitelist = {}) {
    shelljs.exec(`cds build --production`, { silent: true });
    migrationCheck.update();
    const schemaPath = path.join(process.cwd(), "db", "schema.cds");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    const servicePath = path.join(process.cwd(), "srv", "service.cds");
    const service = fs.readFileSync(servicePath, "utf-8");
    const { schema: schemaModified, service: serviceModified } = cb(schema, service);
    fs.writeFileSync(schemaPath, schemaModified ?? schema);
    fs.writeFileSync(servicePath, serviceModified ?? service);
    const whitelistPath = path.join(
      process.cwd(),
      cds.env.migrationCheck.baseDir,
      "migration-extension-whitelist.json",
    );
    fs.writeFileSync(
      whitelistPath,
      JSON.stringify({
        definitions: whitelist,
      }),
    );
    shelljs.exec(`cds build --production`, { silent: true });
    fs.writeFileSync(schemaPath, schema);
    fs.writeFileSync(servicePath, service);
    return migrationCheck.check();
  }
});
