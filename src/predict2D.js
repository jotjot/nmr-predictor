'use strict'
/**
 * Created by acastillo on 7/5/16.
 */
const OCLE = require('openchemlib-extended');
const lib = require('./index.js');

class NmrPredictor2D {

    constructor(dbs) {
        this.dbs = dbs;
    }

    setDB(dbs){
        this.dbs = dbs;
    }

    predict(molfile, options) {
        let mol = molfile;
        if(typeof molfile === 'string') {
            mol = OCLE.Molecule.fromMolfile(molfile);
            mol.addImplicitHydrogens();
        }
        let paths = mol.getAllPaths(options);
        let predictor0 = new lib.NmrPredictor1D(this.dbs[0] || "spinus");
        let predictor1 = new lib.NmrPredictor1D(this.dbs[1] || "spinus");

        return predictor0.predict(mol, {group:true}).then(predictions => {
            let idMap = {};
            predictions.forEach(prediction => {
                idMap[prediction["diaIDs"][0]] = prediction;
            });

            paths.forEach(element => {
                element.fromChemicalShift = idMap[element.fromDiaID].delta;
                element.toChemicalShift = idMap[element.toDiaID].delta;
                //@TODO Add the coupling constants in any case!!!!!!
                element.j = this.getCouplingConstant(idMap, element.fromDiaID, element.toDiaID);
            });

            return paths;
        });
    }

    getCouplingConstant(idMap, fromDiaID, toDiaID) {
        let j = idMap[fromDiaID].j;
        if(j) {
            let index = j.length - 1;
            while(index-- > 0) {
                if(j[index].diaID === toDiaID) {
                    return j[index].coupling;
                }
            }
        }

        return 0;
    }
}


module.exports = NmrPredictor2D;