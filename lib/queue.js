

var async = require("./../node_modules/async");

function theQ (options, Node) {

  var self = this;
  var idType;

  self.output = {};
  self.input = {};

  // building options
  if (!!options.useOriginalID) {
    idType = "_id";
  } else {
    idType = "osm_id";
  }

  if (!!options.upsert) {
    self.save = upsert;
  } else {
    self.save = save;
  }

  var wayFunction
  if (!!options.way.populateGeometry) {
    wayFunction = populateWayGeo;
  } else {
    wayFunction = standardWay;
  }

  // private functions
  function saveCB (err, doc) {
    if (!!err) return console.log(err);
    var type = doc.constructor.modelName;
    self.input[type] = self.input[type]+1 || 1;
    if (!!options.verbose) {
      console.log(doc);
      process.stdout.write("\n\n################################################\n");
    }
  }

  function upsert () {
    var Model = this.model(this.constructor.modelName),
        value = this.toObject(),
        query = {};
    query[idType] = value.osm_id;
    delete value._id;
    Model.findOneAndUpdate(query, value, {upsert: true}, saveCB);
  }

  function save() {
    this.save(saveCB);
  }

  function populateWayGeo (way, cb) {
    var Node = way.constructor.base.models.node;
    var query = {osm_id: {$in: way.loc.nodes}};
    var select = {"loc.coordinates": true};
    select[idType] = true;

    Node.find(query, select, populateWay);

    function populateWay (err, doc) {
      // TODO: Research Sharding - on average it takes 3 Milliseconds to
      // sort and populate the document. Querying the nodes is the majority of lag.
      //
      // with 2.2 Milion nodes i was seeing anywhere from 7 to 900 saves every 3 sec.
      // and was maxing out my laptop. Not so sure sharding will help locally but it
      // may speed up it a little.
      if (err) return console.log(err, way);

      var i = way.loc.nodes.length;
      var coords = [];

      for (i;i--;) {// array to match to
        var b = doc.length;
        var nodeID = way.loc.nodes[i];
        for (b;b--;) {// array being matched
          if (doc[b] && doc[b][idType] === nodeID) {
            coords.unshift(doc[b].loc.coordinates);
            continue;
          }
        }
      }

      way.set('loc.coordinates', coords);
      var isCircularId = way.loc.nodes[0] === way.loc.nodes[way.loc.nodes.length-1];
      var isCircularLtLng = coords[0] === coords[coords.length-1];

      if (isCircularId || isCircularLtLng ) {
        way.set('loc.type', 'Polygon');
      } else {
        way.set('loc.type', 'LineString');
      }

      self.save.call(way);
      cb();
    }
  }

  function standardWay (way, cb) {
    var isCircularId = way.loc.nodes[0] === way.loc.nodes[way.loc.nodes.length-1];
    if (isCircularId) {
      way.set( 'loc.type', 'Polygon');
    } else {
      way.set( 'loc.type', 'LineString');
    }
    self.save.call(way);
    cb();
  }

  // public queues
  self.processNode = function (node, cb) {
    var type = node.constructor.modelName;
    self.output[type] = self.output[type]+1 || 1;
    node.set("loc.type", "Point");
    self.save.call(node);
    cb();
  };

  self.processWay = function (way, cb) {
    var type = way.constructor.modelName;
    self.output[type] = self.output[type]+1 || 1;
    wayFunction(way,cb);
  };

  self.processRelation = function (relation, cb) {
    var type = node.constructor.modelName;
    self.output[type] = self.output[type]+1 || 1;
    self.save.call(relation);
    cb();
  };

  self.node = async.queue(self.processNode, 1);
  self.way  = async.queue(self.processWay, 50);
  self.relation = async.queue(self.processRelation, 1);

  return self;
};

module.exports = theQ;
