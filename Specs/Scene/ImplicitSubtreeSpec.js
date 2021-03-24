import {
  ImplicitSubtree,
  ImplicitTileset,
  MetadataSchema,
  Resource,
  ResourceCache,
  when,
} from "../../Source/Cesium.js";
import ImplicitTilingTester from "../ImplicitTilingTester.js";

describe("Scene/ImplicitSubtree", function () {
  function availabilityToBooleanArray(availability) {
    if (typeof availability.descriptor === "number") {
      var constant = availability.descriptor === 1;
      var repeated = new Array(availability.lengthBits);
      for (var i = 0; i < availability.lengthBits; i++) {
        repeated[i] = constant;
      }
      return repeated;
    }

    return availability.descriptor.split("").map(function (x) {
      return x === "1";
    });
  }

  function expectTileAvailability(subtree, availability) {
    var expectedAvailability = availabilityToBooleanArray(availability);
    for (var i = 0; i < availability.lengthBits; i++) {
      expect(subtree.tileIsAvailable(i)).toEqual(expectedAvailability[i]);
    }
  }

  function expectContentAvailability(subtree, availabilityArray) {
    for (var i = 0; i < availabilityArray.length; i++) {
      var availability = availabilityArray[i];
      var expectedAvailability = availabilityToBooleanArray(availability);
      for (var j = 0; j < availability.lengthBits; j++) {
        expect(subtree.contentIsAvailable(j, i)).toEqual(
          expectedAvailability[j]
        );
      }
    }
  }

  function expectChildSubtreeAvailability(subtree, availability) {
    var expectedAvailability = availabilityToBooleanArray(availability);
    for (var i = 0; i < availability.lengthBits; i++) {
      expect(subtree.childSubtreeIsAvailable(i)).toEqual(
        expectedAvailability[i]
      );
    }
  }

  // used for spying on ResourceCache.load()
  function fakeLoad(arrayBuffer) {
    return function (options) {
      var fakeCacheResource = {
        typedArray: arrayBuffer,
      };
      options.cacheResource._promise = {
        promise: when.resolve(fakeCacheResource),
      };
    };
  }

  var tilesetResource = new Resource({
    url: "https://example.com/tileset.json",
  });
  var subtreeResource = new Resource({
    url: "https://example.com/test.subtree",
  });
  var mockTileset = {};

  var implicitQuadtreeJson = {
    geometricError: 500,
    refine: "ADD",
    boundingVolume: {
      region: [0, 0, Math.PI / 24, Math.PI / 24, 0, 1000.0],
    },
    content: {
      uri: "https://example.com/{level}/{x}/{y}.b3dm",
    },
    extensions: {
      "3DTILES_implicit_tiling": {
        subdivisionScheme: "QUADTREE",
        subtreeLevels: 2,
        maximumLevel: 1,
        subtrees: {
          uri: "https://example.com/{level}/{x}/{y}.subtree",
        },
      },
    },
  };
  var implicitQuadtree = new ImplicitTileset(
    mockTileset,
    tilesetResource,
    implicitQuadtreeJson
  );

  var implicitOctree = new ImplicitTileset(mockTileset, tilesetResource, {
    geometricError: 500,
    refine: "REPLACE",
    boundingVolume: {
      region: [0, 0, Math.PI / 24, Math.PI / 24, 0, 1000.0],
    },
    content: {
      uri: "https://example.com/{level}/{x}_{y}_{z}.b3dm",
    },
    extensions: {
      "3DTILES_implicit_tiling": {
        subdivisionScheme: "OCTREE",
        subtreeLevels: 2,
        maximumLevel: 3,
        subtrees: {
          uri: "https://example.com/{level}/{x}_{y}_{z}.subtree",
        },
      },
    },
  });

  it("gets availability from internal buffer", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "11010",
        lengthBits: 5,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "11000",
          lengthBits: 5,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: true,
      },
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("gets availability from external buffer", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "11010",
        lengthBits: 5,
        isInternal: false,
      },
      contentAvailability: [
        {
          descriptor: "11000",
          lengthBits: 5,
          isInternal: false,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: false,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
      fakeLoad(results.externalBuffer)
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );

      expect(fetchExternal.calls.count()).toEqual(1);
    });
  });

  it("handles typed arrays with a byte offset", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "11010",
        lengthBits: 5,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "11000",
          lengthBits: 5,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: true,
      },
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );

    // Put the subtree buffer in a larger buffer so the byteOffset is not 0
    var paddingLength = 8;
    var biggerBuffer = new Uint8Array(
      results.subtreeBuffer.length + paddingLength
    );
    biggerBuffer.set(results.subtreeBuffer, paddingLength);
    var subtreeView = new Uint8Array(biggerBuffer.buffer, paddingLength);

    var subtree = new ImplicitSubtree(
      subtreeResource,
      subtreeView,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("tile and content availability can share the same buffer", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "11010",
        lengthBits: 5,
        isInternal: false,
      },
      contentAvailability: [
        {
          shareBuffer: true,
          descriptor: "11010",
          lengthBits: 5,
          isInternal: false,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: false,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );

    var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
      fakeLoad(results.externalBuffer)
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
      expect(fetchExternal.calls.count()).toEqual(1);
    });
  });

  it("external buffer is fetched if it is used for availability", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: 1,
        lengthBits: 5,
        isInternal: false,
      },
      contentAvailability: [
        {
          descriptor: "11000",
          lengthBits: 5,
          isInternal: false,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: false,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );

    var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
      fakeLoad(results.externalBuffer)
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expect(fetchExternal.calls.count()).toEqual(1);
    });
  });

  it("unused external buffers are not fetched", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: 1,
        lengthBits: 5,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "11000",
          lengthBits: 5,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: true,
      },
      other: {
        descriptor: "101010",
        lengthBits: 6,
        isInternal: false,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );

    var fetchExternal = spyOn(
      Resource.prototype,
      "fetchArrayBuffer"
    ).and.returnValue(when.resolve(results.externalBuffer));
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expect(fetchExternal).not.toHaveBeenCalled();
    });
  });

  it("missing contentAvailability is interpreted as 0s", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "11010",
        lengthBits: 5,
        isInternal: true,
      },
      childSubtreeAvailability: {
        descriptor: "1111000010100000",
        lengthBits: 16,
        isInternal: true,
      },
    };
    var expectedContentAvailability = {
      descriptor: 0,
      lengthBits: 5,
      isInternal: true,
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );

    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(subtree, expectedContentAvailability);
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("availability works for quadtrees", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: 1,
        lengthBits: 5,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 0,
        lengthBits: 16,
        isInternal: true,
      },
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("computes level offset", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "110101111",
        lengthBits: 9,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "110101011",
          lengthBits: 9,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 1,
        lengthBits: 64,
        isInternal: true,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitOctree
    );

    expect(subtree.getLevelOffset(2)).toEqual(9);
  });

  it("computes parent Morton index", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "110101111",
        lengthBits: 9,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "110101011",
          lengthBits: 9,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 1,
        lengthBits: 64,
        isInternal: true,
      },
    };
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitOctree
    );

    // 341 = 0b101010101
    //  42 = 0b101010
    expect(subtree.getParentMortonIndex(341)).toBe(42);
  });

  it("availability works for octrees", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: "110101111",
        lengthBits: 9,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: "110101011",
          lengthBits: 9,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 1,
        lengthBits: 64,
        isInternal: true,
      },
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitOctree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("handles subtree with constant-only data", function () {
    var subtreeDescription = {
      tileAvailability: {
        descriptor: 1,
        lengthBits: 9,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: 0,
          lengthBits: 9,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 0,
        lengthBits: 64,
        isInternal: true,
      },
    };

    var constantOnly = true;
    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription,
      constantOnly
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitOctree
    );
    return subtree.readyPromise.then(function () {
      expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      expectContentAvailability(
        subtree,
        subtreeDescription.contentAvailability
      );
      expectChildSubtreeAvailability(
        subtree,
        subtreeDescription.childSubtreeAvailability
      );
    });
  });

  it("rejects ready promise on error", function () {
    var error = new Error("simulated error");
    spyOn(when, "all").and.returnValue(when.reject(error));
    var subtreeDescription = {
      tileAvailability: {
        descriptor: 1,
        lengthBits: 5,
        isInternal: true,
      },
      contentAvailability: [
        {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
      ],
      childSubtreeAvailability: {
        descriptor: 0,
        lengthBits: 16,
        isInternal: true,
      },
    };

    var results = ImplicitTilingTester.generateSubtreeBuffers(
      subtreeDescription
    );
    var subtree = new ImplicitSubtree(
      subtreeResource,
      results.subtreeBuffer,
      implicitQuadtree
    );
    return subtree.readyPromise
      .then(function () {
        fail();
      })
      .otherwise(function (error) {
        expect(error).toEqual(error);
      });
  });

  describe("3DTILES_multiple_contents", function () {
    var multipleContentsQuadtree = new ImplicitTileset(
      mockTileset,
      tilesetResource,
      {
        geometricError: 500,
        refine: "ADD",
        boundingVolume: {
          region: [0, 0, Math.PI / 24, Math.PI / 24, 0, 1000.0],
        },
        extensions: {
          "3DTILES_implicit_tiling": {
            subdivisionScheme: "QUADTREE",
            subtreeLevels: 2,
            maximumLevel: 1,
            subtrees: {
              uri: "https://example.com/{level}/{x}/{y}.subtree",
            },
          },
          "3DTILES_multiple_contents": {
            content: [
              {
                uri: "https://example.com/{level}/{x}/{y}.b3dm",
              },
              {
                uri: "https://example.com/{level}/{x}/{y}.pnts",
              },
            ],
          },
        },
      }
    );

    it("contentIsAvailable throws for out-of-bounds contentIndex", function () {
      var subtreeDescription = {
        tileAvailability: {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: 1,
            lengthBits: 5,
            isInternal: true,
          },
          {
            descriptor: "10011",
            lengthBits: 5,
            isInternal: true,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
      };
      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        multipleContentsQuadtree
      );

      var outOfBounds = 100;
      return subtree.readyPromise.then(function () {
        expect(function () {
          subtree.contentIsAvailable(0, outOfBounds);
        }).toThrowDeveloperError();
      });
    });

    it("contentIsAvailable works for multiple contents", function () {
      var subtreeDescription = {
        tileAvailability: {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: 1,
            lengthBits: 5,
            isInternal: false,
          },
          {
            descriptor: "10011",
            lengthBits: 5,
            isInternal: false,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
      };
      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
        fakeLoad(results.externalBuffer)
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        multipleContentsQuadtree
      );
      return subtree.readyPromise.then(function () {
        expect(fetchExternal).toHaveBeenCalled();
        expectTileAvailability(subtree, subtreeDescription.tileAvailability);
      });
    });
  });

  describe("3DTILES_metadata", function () {
    var schema = {
      classes: {
        tile: {
          properties: {
            highlightColor: {
              type: "ARRAY",
              componentType: "UINT8",
              componentCount: 3,
            },
            buildingCount: {
              type: "UINT16",
            },
          },
        },
      },
    };

    var highlightColors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [255, 0, 255],
    ];
    var buildingCounts = [100, 800, 500, 350, 200];

    var tileTableDescription = {
      class: "tile",
      properties: {
        highlightColor: highlightColors,
        buildingCount: buildingCounts,
      },
    };

    var featureTablesDescription = {
      schema: schema,
      featureTables: {
        tiles: tileTableDescription,
      },
    };

    var mockTilesetWithMetadata = {
      metadata: {
        schema: new MetadataSchema(schema),
      },
    };

    var metadataQuadtree = new ImplicitTileset(
      mockTilesetWithMetadata,
      tilesetResource,
      implicitQuadtreeJson
    );

    it("creates a metadata table from internal metadata", function () {
      var subtreeDescription = {
        tileAvailability: {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: 1,
            lengthBits: 5,
            isInternal: true,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
        metadata: {
          isInternal: true,
          featureTables: featureTablesDescription,
        },
      };

      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
        fakeLoad(results.externalBuffer)
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        metadataQuadtree
      );

      return subtree.readyPromise.then(function () {
        expect(fetchExternal).not.toHaveBeenCalled();

        var metadataTable = subtree.metadataTable;
        expect(metadataTable).toBeDefined();
        expect(metadataTable.count).toBe(5);

        for (var i = 0; i < buildingCounts.length; i++) {
          expect(metadataTable.getProperty(i, "highlightColor")).toEqual(
            highlightColors[i]
          );
          expect(metadataTable.getProperty(i, "buildingCount")).toBe(
            buildingCounts[i]
          );
        }
      });
    });

    it("creates a metadata table from external metadata", function () {
      var subtreeDescription = {
        tileAvailability: {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: 1,
            lengthBits: 5,
            isInternal: true,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
        metadata: {
          isInternal: false,
          featureTables: featureTablesDescription,
        },
      };

      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var fetchExternal = spyOn(ResourceCache, "load").and.callFake(
        fakeLoad(results.externalBuffer)
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        metadataQuadtree
      );

      return subtree.readyPromise.then(function () {
        expect(fetchExternal).toHaveBeenCalled();

        var metadataTable = subtree.metadataTable;
        expect(metadataTable).toBeDefined();
        expect(metadataTable.count).toBe(5);

        for (var i = 0; i < buildingCounts.length; i++) {
          expect(metadataTable.getProperty(i, "highlightColor")).toEqual(
            highlightColors[i]
          );
          expect(metadataTable.getProperty(i, "buildingCount")).toBe(
            buildingCounts[i]
          );
        }
      });
    });

    it("handles unavailable tiles correctly", function () {
      var highlightColors = [
        [255, 0, 0],
        [255, 255, 0],
        [255, 0, 255],
      ];

      var buildingCounts = [100, 350, 200];

      var tileTableDescription = {
        class: "tile",
        properties: {
          highlightColor: highlightColors,
          buildingCount: buildingCounts,
        },
      };

      var featureTablesDescription = {
        schema: schema,
        featureTables: {
          tiles: tileTableDescription,
        },
      };

      var subtreeDescription = {
        tileAvailability: {
          descriptor: "10011",
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: "10011",
            lengthBits: 5,
            isInternal: true,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
        metadata: {
          isInternal: true,
          featureTables: featureTablesDescription,
        },
      };

      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        metadataQuadtree
      );
      return subtree.readyPromise.then(function () {
        expect(subtree._jumpBuffer).toEqual({
          0: 0,
          3: 1,
          4: 2,
        });

        var metadataTable = subtree.metadataTable;
        expect(metadataTable).toBeDefined();
        expect(metadataTable.count).toBe(3);

        for (var i = 0; i < buildingCounts.length; i++) {
          expect(metadataTable.getProperty(i, "highlightColor")).toEqual(
            highlightColors[i]
          );
          expect(metadataTable.getProperty(i, "buildingCount")).toBe(
            buildingCounts[i]
          );
        }
      });
    });

    it("handles metadata with string and array offsets", function () {
      var arraySchema = {
        classes: {
          tile: {
            properties: {
              stringProperty: {
                type: "STRING",
              },
              arrayProperty: {
                type: "ARRAY",
                componentType: "INT16",
              },
              arrayOfStringProperty: {
                type: "ARRAY",
                componentType: "STRING",
              },
            },
          },
        },
      };

      var stringValues = ["foo", "bar", "baz", "qux", "quux"];
      var arrayValues = [[1, 2], [3], [4, 5, 6], [7], []];
      var stringArrayValues = [["foo"], ["bar", "bar"], ["qux"], ["quux"], []];

      var tileTableDescription = {
        class: "tile",
        properties: {
          stringProperty: stringValues,
          arrayProperty: arrayValues,
          arrayOfStringProperty: stringArrayValues,
        },
      };

      var featureTablesWithOffsets = {
        schema: arraySchema,
        featureTables: {
          tiles: tileTableDescription,
        },
      };

      var subtreeDescription = {
        tileAvailability: {
          descriptor: 1,
          lengthBits: 5,
          isInternal: true,
        },
        contentAvailability: [
          {
            descriptor: 1,
            lengthBits: 5,
            isInternal: true,
          },
        ],
        childSubtreeAvailability: {
          descriptor: 0,
          lengthBits: 16,
          isInternal: true,
        },
        metadata: {
          isInternal: true,
          featureTables: featureTablesWithOffsets,
        },
      };

      var mockTilesetWithArrayMetadata = {
        metadata: {
          schema: new MetadataSchema(arraySchema),
        },
      };

      var arrayQuadtree = new ImplicitTileset(
        mockTilesetWithArrayMetadata,
        tilesetResource,
        implicitQuadtreeJson
      );

      var results = ImplicitTilingTester.generateSubtreeBuffers(
        subtreeDescription
      );
      var subtree = new ImplicitSubtree(
        subtreeResource,
        results.subtreeBuffer,
        arrayQuadtree
      );
      return subtree.readyPromise.then(function () {
        var metadataTable = subtree.metadataTable;
        expect(metadataTable).toBeDefined();
        expect(metadataTable.count).toBe(5);

        for (var i = 0; i < buildingCounts.length; i++) {
          expect(metadataTable.getProperty(i, "stringProperty")).toBe(
            stringValues[i]
          );
          expect(metadataTable.getProperty(i, "arrayProperty")).toEqual(
            arrayValues[i]
          );
          expect(metadataTable.getProperty(i, "arrayOfStringProperty")).toEqual(
            stringArrayValues[i]
          );
        }
      });
    });
  });
});
